
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
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showApkModal, setShowApkModal] = useState(false);
  const [apkModalTab, setApkModalTab] = useState<'terminal' | 'studio'>('terminal');

  // Tools and Selection
  const [activeTool, setActiveTool] = useState<ToolMode>('ai');
  const [isSelecting, setIsSelecting] = useState(false);
  const [selection, setSelection] = useState<SelectionArea | null>(null);
  const [startPoint, setStartPoint] = useState<{ x: number, y: number } | null>(null);
  const [selectedText, setSelectedText] = useState('');
  const [selectionImage, setSelectionImage] = useState<string | null>(null);
  const [activeHandle, setActiveHandle] = useState<HandleType>(null);
  const [initialSelection, setInitialSelection] = useState<SelectionArea | null>(null);

  // Manual Edit State
  const [manualText, setManualText] = useState({ target: '', replacement: '', size: 12, color: '#000000' });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfFile = historyIndex >= 0 ? history[historyIndex] : null;

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
      const handleSize = 4;
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
    setSelectedText('');
    setSelectionImage(null);
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
    if (wasSelecting && selection) {
      await performVisualOCROnSelection();
    }
  };

  const performVisualOCROnSelection = async () => {
    if (!canvasRef.current || !selection) return;
    const canvas = canvasRef.current;
    setStatusMessage("Analyzing Content...");
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
        
        // Context-aware update: if manual text tool is active, pre-fill target
        if (activeTool === 'text') {
          setManualText(prev => ({ ...prev, target: ocrText === 'No text found' ? '' : ocrText }));
        }

        setStatusMessage(ocrText.includes("No text") ? "Target Locked" : "Text Identified");
        setTimeout(() => setStatusMessage(""), 2000);
      }
    } catch (err) { setStatusMessage("Scan Error"); }
  };

  const handleManualEdit = async () => {
    if (!pdfFile || (!manualText.target && !manualText.replacement)) return;
    setIsProcessing(true);
    setStatusMessage("Applying Changes...");

    try {
      const instruction: EditInstruction = {
        action: manualText.target ? EditActionType.REPLACE_TEXT : EditActionType.ADD_TEXT,
        pageNumber: currentPage,
        explanation: "Direct user edit",
        parameters: {
          targetText: manualText.target,
          newText: manualText.replacement,
          fontSize: manualText.size,
          color: manualText.color,
          x: selection?.x1 || 50,
          y: 100 - (selection?.y1 || 50),
        }
      };

      const updatedPdfBytes = await applyEditsToPdf(pdfFile, [instruction]);
      pushToHistory(updatedPdfBytes);
      await renderPage(updatedPdfBytes, currentPage);
      
      setStatusMessage("Updated!");
      setManualText(prev => ({ ...prev, replacement: '' }));
      setSelection(null);
    } catch (err) {
      console.error(err);
      setStatusMessage("Update Error.");
    } finally {
      setIsProcessing(false);
      setTimeout(() => setStatusMessage(""), 2000);
    }
  };

  const handleCommandExecution = async () => {
    if (!pdfFile || !command.trim()) return;
    setIsProcessing(true);
    setStatusMessage("AI is thinking...");
    
    try {
      const instructions = await processPdfCommand(
        command,
        pdfText,
        pdfMetadata?.pageCount || 1,
        selection || undefined,
        selectedText,
        selectionImage || undefined
      );

      if (!instructions || instructions.length === 0) {
        setStatusMessage("AI found no actions.");
        setIsProcessing(false);
        return;
      }

      setStatusMessage("Architecting Assets...");
      for (const instruction of instructions) {
        if (instruction.action === EditActionType.GENERATE_IMAGE && instruction.parameters.imagePrompt) {
          const generatedUrl = await generateReplacementImage(instruction.parameters.imagePrompt);
          if (generatedUrl) {
            instruction.parameters.imageUrl = generatedUrl;
          }
        }
      }

      setStatusMessage("Re-building Document...");
      const updatedPdfBytes = await applyEditsToPdf(pdfFile, instructions);
      
      pushToHistory(updatedPdfBytes);
      await renderPage(updatedPdfBytes, currentPage);
      
      setStatusMessage("AI Mission Complete!");
      setCommand("");
      setSelection(null);
      setSelectedText('');
    } catch (err) {
      console.error(err);
      setStatusMessage("AI Protocol Failed.");
    } finally {
      setIsProcessing(false);
      setTimeout(() => setStatusMessage(""), 3000);
    }
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
      
      let fullText = "";
      for (let i = 1; i <= Math.min(5, pdf.numPages); i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        fullText += content.items.map((it: any) => it.str).join(" ") + "\n";
      }
      setPdfText(fullText);

      renderPage(bytes, 1);
    } catch (err) { setErrorMessage("Project Load Error"); }
    finally { setIsProcessing(false); }
  };

  const renderPage = async (bytes: Uint8Array, pageNum: number) => {
    if (!canvasRef.current) return;
    try {
      const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: window.innerWidth < 768 ? 1.0 : 1.8 }); 
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

  const downloadPdf = () => {
    if (!pdfFile || !pdfMetadata) return;
    const blob = new Blob([pdfFile], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Architect_${pdfMetadata.name}`;
    link.click();
    URL.revokeObjectURL(url);
    setShowExportMenu(false);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-900 text-white font-sans overflow-hidden">
      <header className="bg-slate-800 border-b border-white/10 p-4 flex items-center justify-between z-50 shadow-2xl">
        <div className="flex items-center gap-4">
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-700 active:scale-90 lg:hidden">
            <i className={`fas ${isSidebarOpen ? 'fa-times' : 'fa-bars'}`}></i>
          </button>
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2 rounded-lg shadow-lg shadow-indigo-500/20"><i className="fas fa-cubes text-sm"></i></div>
            <span className="font-black text-sm tracking-tighter hidden sm:inline">ARCHITECT <span className="text-indigo-400">PRO</span></span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {historyIndex > 0 && (
            <button onClick={() => {setHistoryIndex(historyIndex - 1); renderPage(history[historyIndex - 1], currentPage);}} className="w-10 h-10 rounded-xl bg-slate-700 hover:bg-slate-600 flex items-center justify-center transition-colors">
              <i className="fas fa-undo text-xs"></i>
            </button>
          )}
          <div className="relative">
            <button 
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="bg-indigo-600 hover:bg-indigo-500 px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] active:scale-95 shadow-xl flex items-center gap-3 transition-all"
            >
              <i className="fas fa-file-export"></i> 
              <span>Export</span>
            </button>

            {showExportMenu && (
              <div className="absolute right-0 mt-3 w-64 bg-slate-800 border border-white/10 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] overflow-hidden z-[60] animate-in fade-in zoom-in-95">
                <button onClick={downloadPdf} className="w-full p-4 flex items-center gap-4 hover:bg-white/5 text-left transition-colors">
                  <div className="w-8 h-8 rounded-lg bg-red-500/20 flex items-center justify-center text-red-400"><i className="fas fa-file-pdf"></i></div>
                  <div className="flex-1"><p className="text-xs font-bold">Download PDF</p></div>
                </button>
                <button onClick={() => { setShowApkModal(true); setShowExportMenu(false); }} className="w-full p-4 flex items-center gap-4 hover:bg-white/5 text-left transition-colors border-t border-white/5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center text-emerald-400"><i className="fab fa-android"></i></div>
                  <div className="flex-1"><p className="text-xs font-bold">Build APK</p></div>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 flex relative">
        <aside className={`absolute lg:static inset-y-0 left-0 w-full lg:w-[380px] bg-slate-800 border-r border-white/5 shadow-2xl transition-transform duration-300 z-40 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
          <div className="p-6 space-y-8 overflow-y-auto h-full scrollbar-hide">
            <section>
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">Toolbox</p>
              <div className="grid grid-cols-3 gap-2 bg-slate-900/50 p-1 rounded-2xl">
                {(['ai', 'text', 'rect'] as ToolMode[]).map(tool => (
                  <button key={tool} onClick={() => {setActiveTool(tool); setSelection(null);}} className={`py-4 rounded-xl flex flex-col items-center gap-2 transition-all ${activeTool === tool ? 'bg-indigo-600 text-white shadow-xl' : 'text-slate-500 hover:text-white'}`}>
                    <i className={`fas ${tool === 'ai' ? 'fa-robot' : tool === 'text' ? 'fa-font' : 'fa-vector-square'}`}></i>
                    <span className="text-[8px] font-black uppercase tracking-widest">{tool}</span>
                  </button>
                ))}
              </div>
            </section>

            {/* AI PANEL: STRICTLY FOR NEURAL INPUT */}
            {activeTool === 'ai' && (
              <section className="bg-slate-900 p-6 rounded-[2rem] border border-white/5 space-y-4 shadow-inner animate-in fade-in slide-in-from-bottom-4">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Neural Input</p>
                  <div className="flex gap-1"><span className={`w-1 h-1 rounded-full bg-indigo-500 ${isProcessing ? 'animate-ping' : ''}`}></span></div>
                </div>
                <textarea 
                  value={command}
                  onChange={e => setCommand(e.target.value)}
                  disabled={isProcessing}
                  placeholder="Example: 'Change the title font color to blue' or 'Add a modern building image here'..."
                  className="w-full h-32 bg-transparent text-sm font-medium resize-none focus:outline-none placeholder:text-slate-700 leading-relaxed disabled:opacity-50"
                />
                <button 
                  onClick={handleCommandExecution}
                  disabled={isProcessing || !pdfFile || !command.trim()}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl active:scale-95 transition-all disabled:opacity-50"
                >
                  {isProcessing ? 'Thinking...' : 'Process with AI'}
                </button>
                <div className="bg-slate-950/50 p-3 rounded-xl">
                  <p className="text-[9px] text-slate-500 text-center uppercase tracking-widest font-bold leading-relaxed">
                    AI will attempt to match original formatting automatically
                  </p>
                </div>
              </section>
            )}

            {/* TEXT PANEL: FOR DIRECT REPLACEMENT / INSERTION */}
            {activeTool === 'text' && (
              <section className="bg-slate-900 p-6 rounded-[2rem] border border-white/5 space-y-5 shadow-inner animate-in fade-in slide-in-from-bottom-4">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">Manual Text Editor</p>
                  <i className="fas fa-font text-xs text-emerald-500/50"></i>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Original Content (Target)</label>
                    <input 
                      type="text" 
                      value={manualText.target}
                      onChange={e => setManualText({...manualText, target: e.target.value})}
                      placeholder="Select text to replace..."
                      className="w-full bg-slate-950 border border-white/5 px-4 py-3 rounded-xl text-xs focus:outline-none focus:border-emerald-500 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1 block">New Content (Replacement)</label>
                    <input 
                      type="text" 
                      value={manualText.replacement}
                      onChange={e => setManualText({...manualText, replacement: e.target.value})}
                      placeholder="Type replacement text..."
                      className="w-full bg-slate-950 border border-white/5 px-4 py-3 rounded-xl text-xs focus:outline-none focus:border-emerald-500 transition-colors"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Font Size</label>
                      <input 
                        type="number" 
                        value={manualText.size}
                        onChange={e => setManualText({...manualText, size: parseInt(e.target.value)})}
                        className="w-full bg-slate-950 border border-white/5 px-4 py-3 rounded-xl text-xs focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Color</label>
                      <div className="flex items-center bg-slate-950 border border-white/5 px-3 py-1 rounded-xl">
                        <input type="color" value={manualText.color} onChange={e => setManualText({...manualText, color: e.target.value})} className="w-6 h-6 bg-transparent border-none" />
                        <span className="text-[10px] font-mono ml-2 opacity-50 uppercase">{manualText.color}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <button 
                  onClick={handleManualEdit}
                  disabled={isProcessing || (!manualText.target && !manualText.replacement)}
                  className="w-full bg-emerald-600 text-white hover:bg-emerald-500 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl active:scale-95 transition-all disabled:opacity-50"
                >
                  Apply Text Change
                </button>
              </section>
            )}

            {activeTool === 'rect' && (
              <section className="bg-slate-900 p-6 rounded-[2rem] border border-white/5 space-y-5 shadow-inner animate-in fade-in slide-in-from-bottom-4">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black text-amber-400 uppercase tracking-widest">Shape Architect</p>
                  <i className="fas fa-vector-square text-xs text-amber-500/50"></i>
                </div>
                <div className="p-8 text-center bg-slate-950/50 rounded-2xl border border-dashed border-white/10">
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-relaxed">Draw on the canvas to define shape boundaries</p>
                </div>
              </section>
            )}

            {!pdfFile && (
              <label className="group block w-full bg-white text-slate-900 p-8 rounded-[2.5rem] text-center cursor-pointer active:scale-95 transition-all shadow-2xl hover:bg-indigo-50">
                <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                  <i className="fas fa-file-upload text-2xl text-indigo-600"></i>
                </div>
                <p className="font-black text-xs uppercase tracking-[0.2em]">Open PDF Project</p>
                <input type="file" accept=".pdf" className="hidden" onChange={handleFileUpload} />
              </label>
            )}
          </div>
        </aside>

        <main className="flex-1 bg-slate-950 overflow-auto flex items-start justify-center p-4 lg:p-12 relative scrollbar-hide">
          {pdfFile ? (
            <div className="relative shadow-[0_50px_100px_-20px_rgba(0,0,0,0.8)] rounded-sm overflow-hidden bg-white">
              <canvas 
                ref={canvasRef}
                onMouseDown={handleStart} onMouseMove={handleMove} onMouseUp={handleEnd}
                onTouchStart={handleStart} onTouchMove={handleMove} onTouchEnd={handleEnd}
                className={`block max-w-full ${activeTool === 'text' ? 'cursor-text' : activeTool === 'ai' ? 'cursor-crosshair' : 'cursor-cell'}`}
              />
              {selection && (
                <div 
                  className={`absolute border-2 pointer-events-none ring-1 ring-white/20 transition-all ${activeTool === 'ai' ? 'border-indigo-500 bg-indigo-500/5' : activeTool === 'text' ? 'border-emerald-500 bg-emerald-500/5' : 'border-amber-500 bg-amber-500/5'}`}
                  style={{ left: `${selection.x1}%`, top: `${selection.y1}%`, width: `${selection.x2 - selection.x1}%`, height: `${selection.y2 - selection.y1}%` }}
                >
                  <div className={`absolute -top-3 -left-3 w-8 h-8 bg-white border-2 rounded-full shadow-lg flex items-center justify-center text-[10px] font-black ${activeTool === 'ai' ? 'border-indigo-500 text-indigo-600' : 'border-emerald-500 text-emerald-600'}`}>
                    <i className={`fas ${activeTool === 'ai' ? 'fa-robot' : 'fa-font'}`}></i>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="m-auto text-center">
              <div className="w-32 h-32 bg-slate-800 rounded-[3rem] flex items-center justify-center mx-auto mb-8 animate-pulse shadow-inner">
                <i className="fas fa-file-pdf text-slate-700 text-6xl"></i>
              </div>
              <p className="font-black text-slate-700 uppercase tracking-[0.5em] text-sm">Upload a document to begin</p>
            </div>
          )}

          {pdfFile && (
             <div className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-slate-800/90 backdrop-blur-2xl px-8 py-4 rounded-full border border-white/10 flex items-center gap-8 shadow-2xl z-40">
                <button onClick={() => {const np = Math.max(1, currentPage-1); setCurrentPage(np); renderPage(pdfFile, np);}} className="text-slate-400 hover:text-white transition-colors"><i className="fas fa-chevron-left"></i></button>
                <div className="text-center">
                  <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Page</p>
                  <span className="text-xs font-black tabular-nums">{currentPage} <span className="text-white/20">/</span> {pdfMetadata?.pageCount}</span>
                </div>
                <button onClick={() => {const np = Math.min(pdfMetadata!.pageCount, currentPage+1); setCurrentPage(np); renderPage(pdfFile, np);}} className="text-slate-400 hover:text-white transition-colors"><i className="fas fa-chevron-right"></i></button>
             </div>
          )}
        </main>
      </div>

      {showApkModal && (
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-xl z-[100] flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className="bg-slate-900 w-full max-w-2xl rounded-[3rem] border border-white/10 shadow-[0_50px_100px_rgba(0,0,0,0.8)] overflow-hidden">
            <div className="p-8 lg:p-12 space-y-8">
              <div className="text-center">
                <div className="w-20 h-20 bg-emerald-500/20 rounded-[2rem] flex items-center justify-center mx-auto mb-6 text-emerald-400 shadow-xl"><i className="fab fa-android text-4xl"></i></div>
                <h3 className="text-2xl font-black tracking-tighter">Android Workspace Build</h3>
                <div className="flex justify-center gap-2 mt-6">
                  <button onClick={() => setApkModalTab('terminal')} className={`px-6 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${apkModalTab === 'terminal' ? 'bg-indigo-600' : 'bg-slate-800 text-slate-500'}`}>Terminal Prep</button>
                  <button onClick={() => setApkModalTab('studio')} className={`px-6 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${apkModalTab === 'studio' ? 'bg-indigo-600' : 'bg-slate-800 text-slate-500'}`}>Studio Build</button>
                </div>
              </div>

              {apkModalTab === 'terminal' ? (
                <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
                  <div className="bg-black/50 p-6 rounded-[2rem] font-mono text-[11px] border border-white/5 relative group">
                    <p className="text-indigo-400 mb-2"># Install & Sync</p>
                    <p className="text-slate-300">npm install</p>
                    <p className="text-slate-300">npx cap sync android</p>
                    <p className="text-indigo-400 mt-4 mb-2"># Launch Android Studio</p>
                    <p className="text-slate-300">npx cap open android</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4 animate-in fade-in slide-in-from-left-4">
                  <div className="bg-slate-800/50 p-6 rounded-[2rem] space-y-4">
                    <p className="text-xs font-medium text-slate-300">1. Wait for <span className="text-white font-bold">Gradle Sync</span> to finish.</p>
                    <p className="text-xs font-medium text-slate-300">2. Go to <span className="text-indigo-400 font-bold">Build > Build Bundle(s) / APK(s) > Build APK(s)</span>.</p>
                  </div>
                </div>
              )}
              <button onClick={() => setShowApkModal(false)} className="w-full bg-white text-slate-900 py-5 rounded-[2rem] font-black uppercase tracking-[0.25em] text-xs shadow-2xl active:scale-95 transition-all">Close</button>
            </div>
          </div>
        </div>
      )}

      {statusMessage && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[110] animate-in slide-in-from-bottom-12">
           <div className="bg-indigo-600 text-white px-10 py-4 rounded-full shadow-2xl flex items-center gap-4 border border-white/20">
              <i className="fas fa-bolt animate-pulse"></i>
              <span className="text-[10px] font-black uppercase tracking-widest">{statusMessage}</span>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;
