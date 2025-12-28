
import { GoogleGenAI, Type } from "@google/genai";
import { EditActionType, EditInstruction, SelectionArea } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Performs Visual OCR on a specific image segment using Gemini's vision capabilities.
 */
export const performVisualOCR = async (imageBase64: string): Promise<string> => {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: imageBase64.split(',')[1],
            },
          },
          { text: "Read and extract all text from this image segment. Provide only the extracted text. If no text is visible, respond with 'No text found'." },
        ],
      },
    ],
  });

  return response.text || "";
};

export const processPdfCommand = async (
  command: string, 
  pdfTextContext: string,
  pageCount: number,
  selectionArea?: SelectionArea,
  selectedText?: string,
  selectionImageBase64?: string
): Promise<EditInstruction[]> => {
  const parts: any[] = [
    { text: `
      Act as a PDF layout expert. Interpret the following user command for a PDF document.
      
      GLOBAL CONTEXT (Text extracted from the document):
      ${pdfTextContext.substring(0, 3000)}
      
      SPATIAL CONTEXT:
      ${selectionArea ? `User selected box: X1:${selectionArea.x1}%, Y1:${selectionArea.y1}%, X2:${selectionArea.x2}%, Y2:${selectionArea.y2}%.` : "No specific area selected."}
      TEXT FOUND IN SELECTION: "${selectedText || 'None'}"
      
      USER COMMAND:
      "${command}"
      
      TOTAL PAGES: ${pageCount}

      Instructions:
      1. CRITICAL: Try to preserve original formatting (font size, color, relative position) when replacing text.
      2. If the user refers to "this" or "here", they mean the selection area.
      3. For text replacement, identify the EXACT 'targetText' from the context to replace.
      4. If the user wants to add an image, use EditActionType.GENERATE_IMAGE with an 'imagePrompt'.
      5. Coordinates: X=0 Left, X=100 Right. Y=0 Bottom, Y=100 Top. Note that PDF-lib uses a bottom-up Y coordinate system.
      
      Output JSON array of EditInstruction objects.
    `}
  ];

  if (selectionImageBase64) {
    parts.unshift({
      inlineData: {
        mimeType: "image/jpeg",
        data: selectionImageBase64.split(',')[1],
      }
    });
  }

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [{ parts }],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            action: {
              type: Type.STRING,
              enum: Object.values(EditActionType),
            },
            pageNumber: { type: Type.INTEGER },
            explanation: { type: Type.STRING },
            parameters: {
              type: Type.OBJECT,
              properties: {
                targetText: { type: Type.STRING },
                newText: { type: Type.STRING },
                x: { type: Type.NUMBER },
                y: { type: Type.NUMBER },
                fontSize: { type: Type.NUMBER },
                color: { type: Type.STRING },
                width: { type: Type.NUMBER },
                height: { type: Type.NUMBER },
                shapeType: { type: Type.STRING },
                imagePrompt: { type: Type.STRING },
              },
            },
          },
          required: ["action", "pageNumber", "parameters", "explanation"],
        },
      },
    },
  });

  try {
    return JSON.parse(response.text || "[]");
  } catch (error) {
    console.error("Failed to parse Gemini response:", error);
    return [];
  }
};

export const generateReplacementImage = async (prompt: string): Promise<string | null> => {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [{ text: prompt }],
      },
      config: {
        imageConfig: { aspectRatio: "1:1" }
      },
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    return null;
  } catch (error) {
    console.error("Image generation failed:", error);
    return null;
  }
};
