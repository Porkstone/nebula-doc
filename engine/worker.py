"""Private JSON-lines bridge to an isolated LibreOffice process. No network API."""
import difflib
import json
import os
import re
import shutil
import sys
import tempfile
import time
import traceback
import uno
from com.sun.star.beans import PropertyValue


def prop(name, value):
    p = PropertyValue()
    p.Name, p.Value = name, value
    return p


def utf16len(value):
    return len(value.encode('utf-16-le')) // 2


def is_zero_width_floating_frame(portion):
    """Floating anchors add no text positions; inline objects must stay locked."""
    if portion.String:
        return False
    try:
        contents = portion.createContentEnumeration('com.sun.star.text.TextContent')
        found = False
        while contents.hasMoreElements():
            frame = contents.nextElement()
            if frame.AnchorType.value not in ('AT_CHARACTER', 'AT_PARAGRAPH'):
                return False
            anchor = frame.Anchor
            if anchor.Text.compareRegionStarts(anchor.Start, anchor.End) != 0:
                return False
            found = True
        return found
    except Exception:
        # Unknown objects keep the conservative read-only behaviour.
        return False


def cursor_at(paragraph, start, end=None):
    cursor = paragraph.Text.createTextCursorByRange(paragraph.Start)
    remaining = start
    while remaining:
        step = min(remaining, 30000)
        if not cursor.goRight(step, False):
            raise ValueError('Text offset is outside the paragraph.')
        remaining -= step
    if end is not None:
        remaining = end - start
        while remaining:
            step = min(remaining, 30000)
            if not cursor.goRight(step, True):
                raise ValueError('Text range is outside the paragraph.')
            remaining -= step
    return cursor


class Worker:
    def __init__(self, pipe):
        local = uno.getComponentContext()
        resolver = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
        for attempt in range(600):
            try:
                self.ctx = resolver.resolve('uno:pipe,name=%s;urp;StarOffice.ComponentContext' % pipe)
                break
            except Exception:
                time.sleep(0.1)
        else:
            raise RuntimeError('Could not connect to the local LibreOffice engine.')
        self.desktop = self.ctx.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', self.ctx)
        self.doc = None
        self.paragraphs = {}
        self.managed = set()
        self.snapshots = {}
        self.directory = tempfile.mkdtemp(prefix='nebula-working-')
        self.source = None

    def open(self, path):
        if os.path.splitext(path)[1].lower() != '.doc':
            raise ValueError('Only binary Word 97–2003 .doc files are supported. .docx is not supported.')
        with open(path, 'rb') as stream:
            if stream.read(8) != bytes.fromhex('d0cf11e0a1b11ae1'):
                raise ValueError('This file is not a binary Word .doc document.')
        working = os.path.join(self.directory, 'input-%s.doc' % time.time_ns())
        shutil.copy2(path, working)
        loaded = self.desktop.loadComponentFromURL(uno.systemPathToFileUrl(working), '_blank', 0, (
            prop('Hidden', True), prop('ReadOnly', False), prop('MacroExecutionMode', 0),
            prop('UpdateDocMode', 0), prop('FilterName', 'MS Word 97'),
        ))
        if loaded is None or not loaded.supportsService('com.sun.star.text.TextDocument'):
            raise ValueError('The file could not be opened as a Word document. Encrypted documents are not supported.')
        if self.doc:
            self.doc.close(True)
        self.doc = loaded
        self.source = path
        return self.describe(path)

    def runs(self, paragraph, key=None):
        runs = []
        read_only = False
        parts = paragraph.createEnumeration()
        offset = 0
        while parts.hasMoreElements():
            part = parts.nextElement()
            kind = part.TextPortionType
            if kind == 'Bookmark' and key is not None:
                bookmark = part.Bookmark
                if bookmark is not None:
                    point = dict(blockId=key, offset=offset)
                    edges = self.bookmark_edges.setdefault(bookmark.Name, {})
                    if part.IsCollapsed:
                        edges['start'] = point
                        edges['end'] = point
                    else:
                        edges['start' if part.IsStart else 'end'] = point
            if kind not in ('Text', 'Bookmark', 'SoftPageBreak') and not (
                kind == 'Frame' and is_zero_width_floating_frame(part)
            ):
                read_only = True
            text = part.String
            offset += utf16len(text)
            if not text:
                continue
            try:
                color = int(part.CharColor)
                runs.append(dict(text=text, font=part.CharFontName or 'Arial', size=float(part.CharHeight or 11),
                                 bold=float(part.CharWeight or 100) >= 150,
                                 italic=str(part.CharPosture.value) != 'NONE',
                                 underline=bool(part.CharUnderline), color='#%06x' % (color if color >= 0 else 0x20242b)))
            except Exception:
                runs.append(dict(text=text, font='Arial', size=11, bold=False, italic=False, underline=False, color='#20242b'))
        # Fields and inline objects can have positions unlike their display text.
        # Floating frames have zero-width anchors and survive ordinary range edits.
        merged = []
        for run in runs:
            if merged and all(merged[-1][key] == run[key] for key in run if key != 'text'):
                merged[-1]['text'] += run['text']
            else:
                merged.append(run)
        return merged, read_only

    def blocks(self, text):
        output = []
        items = text.createEnumeration()
        while items.hasMoreElements():
            item = items.nextElement()
            if item.supportsService('com.sun.star.text.TextTable'):
                rows = []
                cells_by_row = {}
                for cell_name in item.getCellNames():
                    match = re.match(r'([A-Z]+)([0-9]+)', cell_name)
                    if not match:
                        continue
                    row = int(match.group(2))
                    cells_by_row.setdefault(row, []).append(dict(blocks=self.blocks(item.getCellByName(cell_name))))
                for row in sorted(cells_by_row):
                    rows.append(dict(cells=cells_by_row[row]))
                output.append(dict(type='table', rows=rows))
            elif item.supportsService('com.sun.star.text.Paragraph'):
                key = 'p%d' % len(self.paragraphs)
                self.paragraphs[key] = item
                runs, read_only = self.runs(item, key)
                if read_only:
                    self.locked.add(key)
                self.snapshots[key] = runs
                align = {0: 'left', 1: 'right', 2: 'justify', 3: 'center'}.get(int(item.ParaAdjust), 'left')
                output.append(dict(type='paragraph', id=key, runs=runs, align=align, readOnly=read_only))
        return output

    def anchor(self, anchor):
        for key, p in self.paragraphs.items():
            try:
                if p.Text.compareRegionStarts(anchor, p.Start) <= 0 and p.Text.compareRegionStarts(anchor, p.End) >= 0:
                    cursor = p.Text.createTextCursorByRange(p.Start)
                    cursor.gotoRange(anchor, True)
                    return dict(blockId=key, offset=utf16len(cursor.String))
            except Exception:
                continue
        return None

    def describe(self, path):
        self.paragraphs = {}
        self.snapshots = {}
        self.bookmark_edges = {}
        self.locked = set()
        blocks = self.blocks(self.doc.Text)
        bookmarks = []
        for name in self.doc.Bookmarks.ElementNames:
            edges = self.bookmark_edges.get(name, {})
            start, end = edges.get('start'), edges.get('end')
            if start is not None and end is not None:
                bookmarks.append(dict(name=name, start=start, end=end))
        self.managed = {b['name'] for b in bookmarks}
        try:
            pages = self.doc.CurrentController.PageCount
        except Exception:
            pages = 1
        return dict(name=os.path.basename(path), path=path, blocks=blocks, bookmarks=bookmarks,
                    pages=pages, bookmarkCount=self.doc.Bookmarks.Count)

    def validate(self, paragraphs, bookmarks):
        if not self.doc:
            raise ValueError('Open a document first.')
        if len(paragraphs) != len(self.paragraphs) or {p['id'] for p in paragraphs} != set(self.paragraphs):
            raise ValueError('Document structure changed. Paragraph and table structure must be retained.')
        lengths = {}
        for change in paragraphs:
            runs = change['runs']
            for run in runs:
                if not isinstance(run['text'], str) or '\r' in run['text'] or '\x00' in run['text']:
                    raise ValueError('Invalid text.')
                if not 1 <= float(run['size']) <= 400 or not re.fullmatch(r'#[0-9a-fA-F]{6}', run['color']):
                    raise ValueError('Invalid font settings.')
            lengths[change['id']] = utf16len(''.join(r['text'] for r in runs))
            old_runs = self.snapshots[change['id']]
            read_only = change['id'] in self.locked
            if read_only and runs != old_runs:
                raise ValueError('Paragraphs containing fields or embedded objects are preserved and cannot be edited.')
        names = set()
        unmanaged = set(self.doc.Bookmarks.ElementNames) - self.managed
        for b in bookmarks:
            if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,39}', b['name']):
                # Existing Word bookmarks may have names outside the new-bookmark rules.
                if b['name'] not in self.managed:
                    raise ValueError('Use a bookmark name starting with a letter, followed by letters, numbers or underscores (40 characters maximum).')
            if b['name'] in names or b['name'] in unmanaged:
                raise ValueError('Bookmark names must be unique.')
            names.add(b['name'])
            for edge in ('start', 'end'):
                a = b[edge]
                if a['blockId'] not in lengths or not isinstance(a['offset'], int) or not 0 <= a['offset'] <= lengths[a['blockId']]:
                    raise ValueError('A bookmark has an invalid text position.')

    def apply_paragraph(self, change):
        key, runs = change['id'], change['runs']
        if runs == self.snapshots[key]:
            return
        p = self.paragraphs[key]
        before, after = p.String, ''.join(r['text'] for r in runs)
        edits = list(difflib.SequenceMatcher(None, before, after, autojunk=False).get_opcodes())
        for tag, i, j, a, b in reversed(edits):
            if tag != 'equal':
                position = utf16len(before[:i])
                cursor_at(p, position, utf16len(before[:j])).String = ''
                # String assignment treats LF as a new paragraph. Insert native soft
                # line-break controls explicitly so the paragraph identity survives.
                pieces = after[a:b].split('\n')
                for index in range(len(pieces) - 1, -1, -1):
                    if pieces[index]:
                        p.Text.insertString(cursor_at(p, position), pieces[index], False)
                    if index:
                        p.Text.insertControlCharacter(cursor_at(p, position), 1, False)
        offset = 0
        for run in runs:
            end = offset + utf16len(run['text'])
            if end > offset:
                cursor = cursor_at(p, offset, end)
                cursor.CharFontName = run['font']
                cursor.CharHeight = float(run['size'])
                cursor.CharWeight = 150.0 if run['bold'] else 100.0
                cursor.CharPosture = uno.Enum('com.sun.star.awt.FontSlant', 'ITALIC' if run['italic'] else 'NONE')
                cursor.CharUnderline = 1 if run['underline'] else 0
                cursor.CharColor = int(run['color'][1:], 16)
            offset = end

    def save(self, path, paragraphs, bookmarks):
        if os.path.splitext(path)[1].lower() != '.doc':
            raise ValueError('Only .doc output is supported.')
        self.validate(paragraphs, bookmarks)
        # Do not overwrite a source changed by another application since it was opened.
        if os.path.abspath(path) == os.path.abspath(self.source) and hasattr(self, 'source_stamp'):
            if os.stat(path).st_mtime_ns != self.source_stamp:
                raise ValueError('The file changed outside Nebula. Save a copy to avoid overwriting those changes.')
        undo = self.doc.UndoManager
        undo.enterUndoContext('Nebula edits')
        in_context = True
        temporary = None
        try:
            for name in self.managed:
                if self.doc.Bookmarks.hasByName(name):
                    self.doc.Bookmarks.getByName(name).dispose()
            for change in paragraphs:
                self.apply_paragraph(change)
            for b in bookmarks:
                start = cursor_at(self.paragraphs[b['start']['blockId']], b['start']['offset'])
                end = cursor_at(self.paragraphs[b['end']['blockId']], b['end']['offset'])
                start.gotoRange(end, True)
                bookmark = self.doc.createInstance('com.sun.star.text.Bookmark')
                bookmark.Name = b['name']
                start.Text.insertTextContent(start, bookmark, True)
            undo.leaveUndoContext()
            in_context = False
            parent = os.path.dirname(os.path.abspath(path))
            fd, temporary = tempfile.mkstemp(suffix='.doc', prefix='.nebula-', dir=parent)
            os.close(fd)
            self.doc.storeToURL(uno.systemPathToFileUrl(temporary), (prop('FilterName', 'MS Word 97'), prop('Overwrite', True)))
            with open(temporary, 'rb') as stream:
                if stream.read(8) != bytes.fromhex('d0cf11e0a1b11ae1'):
                    raise RuntimeError('The engine did not produce a binary .doc file.')
            if os.path.exists(path) and not os.path.exists(path + '.bak'):
                shutil.copy2(path, path + '.bak')
            os.replace(temporary, path)
            self.source = path
            self.source_stamp = os.stat(path).st_mtime_ns
            self.managed = {b['name'] for b in bookmarks}
            self.snapshots = {p['id']: p['runs'] for p in paragraphs}
            return dict(path=path, name=os.path.basename(path))
        except Exception:
            if in_context:
                undo.leaveUndoContext()
            if undo.isUndoPossible():
                undo.undo()
            if temporary and os.path.exists(temporary):
                os.remove(temporary)
            raise

    def close(self):
        if self.doc:
            self.doc.close(True)
        self.desktop.terminate()
        shutil.rmtree(self.directory, ignore_errors=True)
        return True


def main():
    worker = Worker(sys.argv[1])
    for line in sys.stdin:
        message = json.loads(line)
        try:
            method, params = message['method'], message.get('params', {})
            if method == 'ping':
                result = True
            elif method == 'open':
                result = worker.open(params['path'])
                worker.source_stamp = os.stat(params['path']).st_mtime_ns
            elif method == 'save':
                result = worker.save(**params)
            elif method == 'close':
                result = worker.close()
            else:
                raise ValueError('Unknown document operation.')
            print(json.dumps(dict(id=message['id'], result=result)), flush=True)
            if method == 'close':
                break
        except Exception as error:
            traceback.print_exc(file=sys.stderr)
            print(json.dumps(dict(id=message['id'], error=str(error))), flush=True)


if __name__ == '__main__':
    main()
