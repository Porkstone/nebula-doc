"""Real UNO regression driver, run through scripts/signature-roundtrip.mjs."""
import copy
import json
import os
import sys
import traceback

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'engine'))
from worker import Worker, utf16len


def flatten(blocks):
    for block in blocks:
        if block['type'] == 'paragraph':
            yield block
        else:
            for row in block['rows']:
                for cell in row['cells']:
                    yield from flatten(cell['blocks'])


def frame_snapshot(doc):
    result = []
    for name in sorted(doc.TextFrames.ElementNames):
        frame = doc.TextFrames.getByName(name)
        result.append(dict(name=name, text=frame.Text.String, width=frame.Width,
                           height=frame.Height, anchor=frame.AnchorType.value))
    return result


def verify(worker, source, output):
    with open(source, 'rb') as stream:
        original_bytes = stream.read()
    original = worker.open(source)
    original_paragraphs = list(flatten(original['blocks']))
    original_names = set(worker.doc.Bookmarks.ElementNames)
    original_frames = frame_snapshot(worker.doc)
    assert original_frames, 'Sample must contain a floating frame'
    signature = next(p for p in original_paragraphs if 'Signature Code:' in ''.join(r['text'] for r in p['runs']))
    assert not signature['readOnly'], 'Signature label paragraph must be editable'
    assert any(p['readOnly'] for p in original_paragraphs), 'Unrelated protected paragraphs remain locked'
    paragraphs = [dict(id=p['id'], runs=copy.deepcopy(p['runs'])) for p in original_paragraphs]
    changed = next(p for p in paragraphs if p['id'] == signature['id'])
    changed['runs'][-1]['text'] = changed['runs'][-1]['text'].replace('Signature Code:', 'Signature reference: QA-1234')
    changed['runs'][-1]['font'] = 'Georgia'
    changed['runs'][-1]['size'] = 12
    bookmarks = copy.deepcopy(original['bookmarks'])
    worker.save(output, copy.deepcopy(paragraphs), copy.deepcopy(bookmarks))
    expected = ''.join(r['text'] for r in changed['runs'])
    assert worker.paragraphs[signature['id']].String == expected, (worker.paragraphs[signature['id']].String, expected)
    assert frame_snapshot(worker.doc) == original_frames, 'Editing the label must preserve the floating frame'
    # Also edit at the start of the same paragraph, next to its native anchor.
    changed['runs'][0]['text'] = changed['runs'][0]['text'].replace('Signature(s)', 'Customer signature(s)', 1)
    delta = utf16len('Customer ')
    for bookmark in bookmarks:
        for edge in ('start', 'end'):
            if bookmark[edge]['blockId'] == signature['id']:
                bookmark[edge]['offset'] += delta
    worker.save(output, copy.deepcopy(paragraphs), copy.deepcopy(bookmarks))
    expected = ''.join(r['text'] for r in changed['runs'])
    assert worker.paragraphs[signature['id']].String == expected, (worker.paragraphs[signature['id']].String, expected)
    reopened = worker.open(output)
    result = next(p for p in flatten(reopened['blocks']) if p['id'] == signature['id'])
    assert not result['readOnly']
    assert ''.join(r['text'] for r in result['runs']) == expected, (''.join(r['text'] for r in result['runs']), expected)
    assert any(r['font'] == 'Georgia' and r['size'] == 12 for r in result['runs'])
    reopened_frames = frame_snapshot(worker.doc)
    assert len(reopened_frames) == len(original_frames), 'Floating frames must survive reopening'
    for before, after in zip(original_frames, reopened_frames):
        for attribute in ('name', 'text', 'anchor'):
            assert before[attribute] == after[attribute], (attribute, before, after)
        # Word 97 stores dimensions in twips; UNO exposes hundredths of a mm.
        # Allow one twip of conversion rounding (approximately 0.018 mm).
        for attribute in ('width', 'height'):
            assert abs(before[attribute] - after[attribute]) <= 2, (attribute, before, after)
    assert set(worker.doc.Bookmarks.ElementNames) == original_names, 'All 36 bookmarks, including frame bookmarks, must survive'
    assert reopened['bookmarks'] == bookmarks, 'Bookmark positions must survive the edits'
    assert len(list(flatten(reopened['blocks']))) == len(original_paragraphs)
    with open(source, 'rb') as stream:
        assert stream.read() == original_bytes, 'Original attachment must stay unchanged'
    return dict(signature=signature['id'], bookmarks=len(original_names), frames=len(original_frames), output=output)


def main():
    worker = Worker(sys.argv[1])
    for line in sys.stdin:
        message = json.loads(line)
        try:
            method = message['method']
            if method == 'ping':
                result = True
            elif method == 'close':
                result = worker.close()
            else:
                result = verify(worker, message['params']['source'], message['params']['output'])
            print(json.dumps(dict(id=message['id'], result=result)), flush=True)
            if method == 'close':
                break
        except Exception as error:
            traceback.print_exc(file=sys.stderr)
            print(json.dumps(dict(id=message['id'], error=str(error) or traceback.format_exc())), flush=True)


if __name__ == '__main__':
    main()
