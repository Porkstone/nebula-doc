export interface Run { text: string; font: string; size: number; bold: boolean; italic: boolean; underline: boolean; color: string }
export interface Paragraph { type: 'paragraph'; id: string; runs: Run[]; align: string; readOnly: boolean }
export interface Table { type: 'table'; rows: { cells: { blocks: Block[]; colspan?: number; background?: string }[] }[] }
export type Block = Paragraph | Table
export interface Anchor { blockId: string; offset: number }
export interface Bookmark { name: string; start: Anchor; end: Anchor }
export interface LegacyDocument { name: string; path: string; blocks: Block[]; bookmarks: Bookmark[]; pages: number; bookmarkCount: number }
export interface EditParagraph { id: string; runs: Run[] }
export interface SavePayload { paragraphs: EditParagraph[]; bookmarks: Bookmark[] }
export interface EngineStatus { available: boolean; message: string }
export interface DesktopApi {
  status(): Promise<EngineStatus>
  open(): Promise<LegacyDocument | null>
  save(payload: SavePayload, saveAs: boolean): Promise<{ path: string; name: string } | null>
  setDirty(dirty: boolean): void
  onMenu(callback: (action: string) => void): () => void
}
declare global { interface Window { nebula?: DesktopApi } }
