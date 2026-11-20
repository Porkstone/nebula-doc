import os
import sys
import unittest
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'engine'))
from worker import cell_background, is_zero_width_floating_frame


class Enumeration:
    def __init__(self, items):
        self.items = iter(items)
        self.remaining = len(items)

    def hasMoreElements(self):
        return self.remaining > 0

    def nextElement(self):
        self.remaining -= 1
        return next(self.items)


def frame(kind='AT_CHARACTER', collapsed=True):
    text = SimpleNamespace(compareRegionStarts=lambda start, end: 0 if collapsed else 1)
    anchor = SimpleNamespace(Text=text, Start=object(), End=object())
    return SimpleNamespace(AnchorType=SimpleNamespace(value=kind), Anchor=anchor)


def portion(frames, text=''):
    return SimpleNamespace(String=text, createContentEnumeration=lambda service: Enumeration(frames))


class FloatingFrameTests(unittest.TestCase):
    def test_floating_character_and_paragraph_anchors_allow_surrounding_text(self):
        self.assertTrue(is_zero_width_floating_frame(portion([frame()])))
        self.assertTrue(is_zero_width_floating_frame(portion([frame('AT_PARAGRAPH')])))

    def test_inline_object_is_not_unlocked(self):
        self.assertFalse(is_zero_width_floating_frame(portion([frame('AS_CHARACTER')])))

    def test_mixed_anchor_types_are_not_unlocked(self):
        self.assertFalse(is_zero_width_floating_frame(portion([frame(), frame('AS_CHARACTER')])))

    def test_noncollapsed_or_text_consuming_objects_are_not_unlocked(self):
        self.assertFalse(is_zero_width_floating_frame(portion([frame(collapsed=False)])))
        self.assertFalse(is_zero_width_floating_frame(portion([frame()], '\ufffc')))

    def test_unknown_or_empty_frames_are_not_unlocked(self):
        self.assertFalse(is_zero_width_floating_frame(portion([])))
        self.assertFalse(is_zero_width_floating_frame(portion([frame('AT_PAGE')])))
        self.assertFalse(is_zero_width_floating_frame(SimpleNamespace(String='')))


class CellBackgroundTests(unittest.TestCase):
    def test_solid_shading_is_reported_as_hex(self):
        self.assertEqual(cell_background(SimpleNamespace(BackTransparent=False, BackColor=0x2562C2)), '#2562c2')
        self.assertEqual(cell_background(SimpleNamespace(BackTransparent=False, BackColor=0xFFFFFF)), '#ffffff')

    def test_unshaded_or_unreadable_cells_have_no_background(self):
        self.assertIsNone(cell_background(SimpleNamespace(BackTransparent=True, BackColor=0x2562C2)))
        self.assertIsNone(cell_background(SimpleNamespace(BackTransparent=False, BackColor=-1)))
        self.assertIsNone(cell_background(SimpleNamespace()))


if __name__ == '__main__':
    unittest.main()
