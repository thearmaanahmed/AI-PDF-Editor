
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import { EditActionType, EditInstruction } from '../types';

/**
 * Converts a hex color string to an rgb object for pdf-lib
 */
const hexToRgb = (hex: string) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16) / 255,
    g: parseInt(result[2], 16) / 255,
    b: parseInt(result[3], 16) / 255
  } : { r: 0, g: 0, b: 0 };
};

/**
 * Searches for a text string on a specific page and returns coordinates and formatting metadata.
 */
const findTextCoords = async (
  pdfBytes: Uint8Array, 
  pageNumber: number, 
  searchText: string
): Promise<{ x: number; y: number; width: number; height: number; fontSize?: number } | null> => {
  try {
    const loadingTask = pdfjsLib.getDocument({ data: pdfBytes.slice() });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();

    const item = textContent.items.find((i: any) => 
      i.str.toLowerCase().includes(searchText.toLowerCase())
    ) as any;

    if (item) {
      const transform = item.transform;
      // transform: [scaleX, skewY, skewX, scaleY, translateX, translateY]
      // scaleY is often the font size in points
      const fontSize = Math.abs(transform[3]);
      
      return {
        x: transform[4],
        y: transform[5],
        width: item.width,
        height: fontSize, // Using scaleY as a better proxy for height
        fontSize: fontSize
      };
    }
    return null;
  } catch (e) {
    console.error("Text finding error:", e);
    return null;
  }
};

export const applyEditsToPdf = async (
  pdfBytes: Uint8Array,
  instructions: EditInstruction[]
): Promise<Uint8Array> => {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();

  for (const instruction of instructions) {
    const pageIdx = Math.min(Math.max(0, instruction.pageNumber - 1), pages.length - 1);
    const page = pages[pageIdx];
    const { width: pageWidth, height: pageHeight } = page.getSize();
    const { parameters, action } = instruction;

    let targetX = ((parameters.x || 0) / 100) * pageWidth;
    let targetY = ((parameters.y || 0) / 100) * pageHeight;
    let targetWidth = (parameters.width || 0) * (pageWidth / 100);
    let targetHeight = (parameters.height || 0) * (pageHeight / 100);
    let detectedFontSize = parameters.fontSize;

    // Precise Text Replacement Logic with Formatting Preservation
    if (action === EditActionType.REPLACE_TEXT && parameters.targetText) {
      const coords = await findTextCoords(pdfBytes, instruction.pageNumber, parameters.targetText);
      if (coords) {
        targetX = coords.x;
        targetY = coords.y;
        targetWidth = coords.width;
        targetHeight = coords.height;
        detectedFontSize = coords.fontSize || detectedFontSize;
      }
      
      // "White out" the old text area
      page.drawRectangle({
        x: targetX - 1,
        y: targetY - 1,
        width: targetWidth + 2,
        height: targetHeight + 2,
        color: rgb(1, 1, 1),
      });
      
      const textColor = parameters.color ? hexToRgb(parameters.color) : { r: 0, g: 0, b: 0 };
      
      page.drawText(parameters.newText || '', {
        x: targetX,
        y: targetY,
        size: parameters.fontSize || detectedFontSize || 12,
        font: font,
        color: rgb(textColor.r, textColor.g, textColor.b),
      });
      continue;
    }

    // Image Handling
    if ((action === EditActionType.ADD_IMAGE || action === EditActionType.GENERATE_IMAGE) && parameters.imageUrl) {
      try {
        const imageResp = await fetch(parameters.imageUrl);
        const imageBytes = await imageResp.arrayBuffer();
        const embeddedImage = parameters.imageUrl.includes('png') 
          ? await pdfDoc.embedPng(imageBytes)
          : await pdfDoc.embedJpg(imageBytes);

        page.drawImage(embeddedImage, {
          x: targetX,
          y: targetY,
          width: targetWidth || (pageWidth * 0.25),
          height: targetHeight || (pageHeight * 0.25),
        });
      } catch (e) {
        console.error("Failed to embed image:", e);
      }
      continue;
    }

    // Default Fallbacks
    switch (action) {
      case EditActionType.ADD_TEXT:
        const textColor = parameters.color ? hexToRgb(parameters.color) : { r: 0, g: 0, b: 0 };
        page.drawText(parameters.newText || '', {
          x: targetX,
          y: targetY,
          size: parameters.fontSize || 12,
          font: font,
          color: rgb(textColor.r, textColor.g, textColor.b),
        });
        break;
      case EditActionType.ADD_SHAPE:
        if (parameters.shapeType === 'rect') {
          page.drawRectangle({
            x: targetX,
            y: targetY,
            width: targetWidth,
            height: targetHeight,
            color: rgb(0.9, 0.9, 0.9),
            opacity: 0.5,
          });
        }
        break;
    }
  }

  return await pdfDoc.save();
};
