
export enum EditActionType {
  REPLACE_TEXT = 'REPLACE_TEXT',
  ADD_TEXT = 'ADD_TEXT',
  ADD_IMAGE = 'ADD_IMAGE',
  GENERATE_IMAGE = 'GENERATE_IMAGE',
  DELETE_TEXT = 'DELETE_TEXT',
  ADD_SHAPE = 'ADD_SHAPE',
  UNKNOWN = 'UNKNOWN'
}

export interface SelectionArea {
  x1: number; // 0-100
  y1: number; // 0-100
  x2: number; // 0-100
  y2: number; // 0-100
}

export interface EditInstruction {
  action: EditActionType;
  pageNumber: number;
  parameters: {
    targetText?: string;
    newText?: string;
    x?: number; // 0-100 percentage
    y?: number; // 0-100 percentage
    fontSize?: number;
    color?: string;
    width?: number;
    height?: number;
    shapeType?: 'rect' | 'circle';
    imageUrl?: string;
    imagePrompt?: string; // For AI generation
    imageBytes?: Uint8Array; // For uploaded images
    selectionArea?: SelectionArea;
  };
  explanation: string;
}

export interface PdfMetadata {
  name: string;
  pageCount: number;
  fileSize: number;
}
