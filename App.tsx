
import React, { useState, useRef, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { processPdfCommand, generateReplacementImage, performVisualOCR } from './services/geminiService';
import { applyEditsToPdf } from './services/pdfService';
import { EditActionType, EditInstruction, PdfMetadata, SelectionArea } from './types';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://esm.sh/pdfjs-dist@5.4.449/build/pdf.worker.mjs`;

type ToolMode = 'ai' | 'text' | 'rect';
type HandleType = 'nw' | 'ne' | 'sw' | 'se' | 'move' | null;

const App: React.FC = () => {
  const [history, setHistory] = useState<Uint8Array[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [pdfMetadata, setPdfMetadata] = useState<PdfMetadata | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [command, setCommand] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [pdfText, setPdfText] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 1024);

  // Tools and Selection
  const [activeTool, setActiveTool] = useState<ToolMode>('ai');
  const [isSelecting, setIsSelecting] = useState(false);
  const [selection, setSelection] = useState<SelectionArea | null>(null);
  const [startPoint, setStartPoint] = useState<{ x: number, y: number } | null>(null);
  const [selectedText, setSelectedText] = useState('');
  const [selectionImage, setSelectionImage] = useState<string | null>(null);
  const [stagedAsset, setStagedAsset] = useState<{ type: 'image' | 'text', content: string } | null>(null);
  const [activeHandle, setActiveHandle] = useState<HandleType>(null);
  const [initialSelection, setInitialSelection] = useState<SelectionArea | null>(null);

  // Modals
  const [showTextModal, setShowTextModal] = useState(false);
  const [textConfig, setTextConfig] = useState({ text: '', fontSize: 18, color: '#000000' });
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfFile = historyIndex >= 0 ? history[historyIndex] : null;

  // Unified Coordinates for Mouse & Touch
  const getEventCoords = (e: any) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: ((clientX - rect.left) / rect.width) * 100,
      y: ((clientY - rect.top) / rect.height) * 100
    };
  };

  const handleStart = (e: any) => {
    if (!pdfFile || !canvasRef.current) return;
    const { x, y } = getEventCoords(e);

    if (selection) {
      const handleSize = 4; // Larger handles for touch
      const isNW = Math.abs(x - selection.x1) < handleSize && Math.abs(y - selection.y1) < handleSize;
      const isNE = Math.abs(x - selection.x2) < handleSize && Math.abs(y - selection.y1) < handleSize;
      const isSW = Math.abs(x - selection.x1) < handleSize && Math.abs(y - selection.y2) < handleSize;
      const isSE = Math.abs(x - selection.x2) < handleSize && Math.abs(y - selection.y2) < handleSize;
      const isInside = x > selection.x1 && x < selection.x2 && y > selection.y1 && y < selection.y2;

      if (isNW) setActiveHandle('nw');
      else if (isNE) setActiveHandle('ne');
      else if (isSW) setActiveHandle('sw');
      else if (isSE) setActiveHandle('se');
      else if (isInside) setActiveHandle('move');
      else setActiveHandle(null);

      if (isNW || isNE || isSW || isSE || isInside) {
        setStartPoint({ x, y });
        setInitialSelection({ ...selection });
        return;
      }
    }

    setStartPoint({ x, y });
    setIsSelecting(true);
    setSelection(null);
    setStagedAsset(null);
  };

  const handleMove = (e: any) => {
    if (!canvasRef.current || (!isSelecting && !activeHandle)) return;
    const { x, y } = getEventCoords(e);

    if (isSelecting && startPoint) {
      setSelection({
        x1: Math.min(startPoint.x, x),
        y1: Math.min(startPoint.y, y),
        x2: Math.max(startPoint.x, x),
        y2: Math.max(startPoint.y, y),
      });
    } else if (activeHandle && initialSelection && startPoint) {
      const dx = x - startPoint.x;
      const dy = y - startPoint.y;
      const newSel = { ...initialSelection };
      switch (activeHandle) {
        case 'nw': newSel.x1 += dx; newSel.y1 += dy; break;
        case 'ne': newSel.x2 += dx; newSel.y1 += dy; break;
        case 'sw': newSel.x1 += dx; newSel.y2 += dy; break;
        case 'se': newSel.x2 += dx; newSel.y2 += dy; break;
        case 'move': newSel.x1 += dx; newSel.x2 += dx; newSel.y1 += dy; newSel.y2 += dy; break;
      }
      setSelection(newSel);
    }
  };

  const handleEnd = async () => {
    const wasSelecting = isSelecting;
    setIsSelecting(false);
    setActiveHandle(null);
    if (wasSelecting && selection && activeTool === 'ai') {
      await performVisualOCROnSelection();
    }
  };

  const performVisualOCROnSelection = async () => {
    if (!canvasRef.current || !selection) return;
    const canvas = canvasRef.current;
    setStatusMessage("Scanning...");
    try {
      const cropX = (selection.x1 / 100) * canvas.width;
      const cropY = (selection.y1 / 100) * canvas.height;
      const cropW = ((selection.x2 - selection.x1) / 100) * canvas.width;
      const cropH = ((selection.y2 - selection.y1) / 100) * canvas.height;
      const offscreen = document.createElement('canvas');
      offscreen.width = cropW; offscreen.height = cropH;
      const offCtx = offscreen.getContext('2d');
      if (offCtx) {
        offCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
        const dataUrl = offscreen.toDataURL('image/jpeg', 0.85);
        setSelectionImage(dataUrl);
        const ocrText = await performVisualOCR(dataUrl);
        setSelectedText(ocrText);
        setStatusMessage(ocrText.includes("No text") ? "Target Locked" : "Content Identified");
      }
    } catch (err) { setStatusMessage("Vision Error"); }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsProcessing(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
      setPdfMetadata({ name: file.name, pageCount: pdf.numPages, fileSize: file.size });
      pushToHistory(bytes);
      renderPage(bytes, 1);
    } catch (err) { setErrorMessage("Upload Error"); }
    finally { setIsProcessing(false); }
  };

  const renderPage = async (bytes: Uint8Array, pageNum: number) => {
    if (!canvasRef.current) return;
    try {
      const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: window.innerWidth < 768 ? 1.2 : 2.0 }); 
      const canvas = canvasRef.current;
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      await page.render({ canvasContext: canvas.getContext('2d')!, viewport: viewport }).promise;
    } catch (err) { console.error(err); }
  };

  const pushToHistory = (newBytes: Uint8Array) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newBytes);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-900 text-white font-sans overflow-hidden">
      {/* Mobile-Optimized Header */}
      <header className="bg-slate-800 border-b border-white/10 p-4 flex items-center justify-between z-50">
        <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-700 active:scale-90 lg:hidden">
          <i className={`fas ${isSidebarOpen ? 'fa-times' : 'fa-bars'}`}></i>
        </button>
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-lg"><i className="fas fa-cubes text-sm"></i></div>
          <span className="font-black text-sm tracking-tighter">ARCHITECT <span className="text-indigo-400">PRO</span></span>
        </div>
        <div className="flex gap-2">
          <button onClick={() => {}} className="bg-indigo-600 px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest active:scale-95 shadow-lg">Export</button>
        </div>
      </header>

      <div className="flex-1 flex relative">
        {/* Sidebar / Drawer */}
        <aside className={`absolute lg:static inset-y-0 left-0 w-full lg:w-[380px] bg-slate-800 border-r border-white/5 shadow-2xl transition-transform duration-300 z-40 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
          <div className="p-6 space-y-8 overflow-y-auto h-full">
            <section>
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">Toolbox</p>
              <div className="grid grid-cols-3 gap-2 bg-slate-900/50 p-1 rounded-2xl">
                {(['ai', 'text', 'rect'] as ToolMode[]).map(tool => (
                  <button key={tool} onClick={() => setActiveTool(tool)} className={`py-4 rounded-xl flex flex-col items-center gap-2 transition-all ${activeTool === tool ? 'bg-indigo-600 text-white shadow-xl' : 'text-slate-500 hover:text-white'}`}>
                    <i className={`fas ${tool === 'ai' ? 'fa-robot' : tool === 'text' ? 'fa-font' : 'fa-vector-square'}`}></i>
                    <span className="text-[8px] font-black uppercase">{tool}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="bg-slate-900 p-5 rounded-3xl border border-white/5 space-y-4">
              <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Neural Input</p>
              <textarea 
                value={command}
                onChange={e => setCommand(e.target.value)}
                placeholder="Replace header text..."
                className="w-full h-32 bg-transparent text-sm font-medium resize-none focus:outline-none"
              />
              <button onClick={() => {}} className="w-full bg-indigo-600 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl active:scale-95">Execute Command</button>
            </section>

            {!pdfFile && (
              <label className="block w-full bg-white text-slate-900 p-6 rounded-3xl text-center cursor-pointer active:scale-95 transition-transform shadow-2xl">
                <i className="fas fa-file-upload text-2xl mb-2"></i>
                <p className="font-black text-xs uppercase tracking-widest">Load Document</p>
                <input type="file" accept=".pdf" className="hidden" onChange={handleFileUpload} />
              </label>
            )}
          </div>
        </aside>

        {/* PDF Canvas Area */}
        <main className="flex-1 bg-slate-950 overflow-auto flex items-start justify-center p-4 lg:p-12 relative">
          {pdfFile ? (
            <div className="relative shadow-2xl rounded-sm overflow-hidden bg-white">
              <canvas 
                ref={canvasRef}
                onMouseDown={handleStart} onMouseMove={handleMove} onMouseUp={handleEnd}
                onTouchStart={handleStart} onTouchMove={handleMove} onTouchEnd={handleEnd}
                className="block max-w-full"
              />
              {selection && (
                <div 
                  className="absolute border-2 border-indigo-500 bg-indigo-500/10 pointer-events-none"
                  style={{ left: `${selection.x1}%`, top: `${selection.y1}%`, width: `${selection.x2 - selection.x1}%`, height: `${selection.y2 - selection.y1}%` }}
                >
                  {/* Resize Handles - Touch Optimized */}
                  <div className="absolute -top-3 -left-3 w-8 h-8 bg-white border-2 border-indigo-500 rounded-full shadow-lg" />
                  <div className="absolute -top-3 -right-3 w-8 h-8 bg-white border-2 border-indigo-500 rounded-full shadow-lg" />
                  <div className="absolute -bottom-3 -left-3 w-8 h-8 bg-white border-2 border-indigo-500 rounded-full shadow-lg" />
                  <div className="absolute -bottom-3 -right-3 w-8 h-8 bg-white border-2 border-indigo-500 rounded-full shadow-lg" />
                </div>
              )}
            </div>
          ) : (
            <div className="m-auto text-center opacity-20">
              <i className="fas fa-file-pdf text-9xl mb-6"></i>
              <p className="font-black uppercase tracking-[0.4em]">Standby</p>
            </div>
          )}

          {/* Page Indicator - Floats at bottom center */}
          {pdfFile && (
             <div className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-slate-800/80 backdrop-blur-xl px-6 py-3 rounded-full border border-white/10 flex items-center gap-6 shadow-2xl">
                <button onClick={() => setCurrentPage(p => Math.max(1, p-1))} className="text-slate-400 hover:text-white"><i className="fas fa-chevron-left"></i></button>
                <span className="text-xs font-black tabular-nums">{currentPage} / {pdfMetadata?.pageCount}</span>
                <button onClick={() => setCurrentPage(p => Math.min(pdfMetadata!.pageCount, p+1))} className="text-slate-400 hover:text-white"><i className="fas fa-chevron-right"></i></button>
             </div>
          )}
        </main>
      </div>

      {statusMessage && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[100] bg-indigo-600 text-white px-8 py-3 rounded-full text-[10px] font-black uppercase tracking-[0.2em] shadow-2xl animate-bounce">
          {statusMessage}
        </div>
      )}
    </div>
  );
};

export default App;
