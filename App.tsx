
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

  // Manual Edit State (Strictly for the Text Tool)
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
      const isInside = x > selection.x1 && x < selection.x2 && y > selection.y1 && y < selection.y2;
      if (isInside) {
        setActiveHandle('move');
        setStartPoint({ x, y });
        setInitialSelection({ ...selection });
        return;
      }
    }
    setStartPoint({ x, y });
    setIsSelecting(true);
    setSelection(null);
    setSelectedText('');
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
    } else if (activeHandle === 'move' && initialSelection && startPoint) {
      const dx = x - startPoint.x;
      const dy = y - startPoint.y;
      setSelection({
        x1: initialSelection.x1 + dx,
        x2: initialSelection.x2 + dx,
        y1: initialSelection.y1 + dy,
        y2: initialSelection.y2 + dy,
      });
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
    setStatusMessage("Extracting Context...");
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
        
        // Auto-fill manual panel only if in Text Mode
        if (activeTool === 'text') {
          setManualText(prev => ({ ...prev, target: ocrText === 'No text found' ? '' : ocrText }));
        }

        setStatusMessage(ocrText.includes("No text") ? "Target Set" : "Content Detected");
        setTimeout(() => setStatusMessage(""), 2000);
      }
    } catch (err) { setStatusMessage("OCR Error"); }
  };

  const handleManualEdit = async () => {
    if (!pdfFile || (!manualText.target && !manualText.replacement)) return;
    setIsProcessing(true);
    setStatusMessage("Applying Manual Edit...");

    try {
      const instruction: EditInstruction = {
        action: manualText.target ? EditActionType.REPLACE_TEXT : EditActionType.ADD_TEXT,
        pageNumber: currentPage,
        explanation: "Manual user overwrite",
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
      
      setStatusMessage("Changes Saved!");
      setManualText(prev => ({ ...prev, replacement: '' }));
      setSelection(null);
    } catch (err) {
      setStatusMessage("Manual edit failed.");
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
        setStatusMessage("No actions suggested.");
        setIsProcessing(false);
        return;
      }

      setStatusMessage("Re-architecting...");
      for (const instruction of instructions) {
        if (instruction.action === EditActionType.GENERATE_IMAGE && instruction.parameters.imagePrompt) {
          const generatedUrl = await generateReplacementImage(instruction.parameters.imagePrompt);
          if (generatedUrl) instruction.parameters.imageUrl = generatedUrl;
        }
      }

      const updatedPdfBytes = await applyEditsToPdf(pdfFile, instructions);
      pushToHistory(updatedPdfBytes);
      await renderPage(updatedPdfBytes, currentPage);
      
      setStatusMessage("AI Edit Complete!");
      setCommand("");
      setSelection(null);
    } catch (err) {
      setStatusMessage("AI Error.");
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
    } catch (err) { setStatusMessage("File Error"); }
    finally { setIsProcessing(false); }
  };

  const renderPage = async (bytes: Uint8Array, pageNum: number) => {
    if (!canvasRef.current) return;
    try {
      const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.8 }); 
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
    link.download = `Architected_${pdfMetadata.name}`;
    link.click();
    URL.revokeObjectURL(url);
    setShowExportMenu(false);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#0f172a] text-white font-sans overflow-hidden select-none">
      {/* Universal Header */}
      <header className="bg-[#1e293b]/80 backdrop-blur-md border-b border-white/5 p-4 flex items-center justify-between z-50">
        <div className="flex items-center gap-4">
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 transition-all lg:hidden">
            <i className={`fas ${isSidebarOpen ? 'fa-times' : 'fa-bars'}`}></i>
          </button>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20 rotate-12">
              <i className="fas fa-cubes text-xs"></i>
            </div>
            <span className="font-black text-xs tracking-widest hidden sm:inline uppercase">Architect <span className="text-indigo-400">Pro</span></span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {historyIndex > 0 && (
            <button onClick={() => {setHistoryIndex(historyIndex - 1); renderPage(history[historyIndex - 1], currentPage);}} className="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 flex items-center justify-center border border-white/5 transition-colors">
              <i className="fas fa-undo-alt text-[10px]"></i>
            </button>
          )}
          <div className="relative">
            <button 
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="bg-indigo-600 hover:bg-indigo-500 px-6 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest active:scale-95 shadow-xl transition-all flex items-center gap-3"
            >
              <i className="fas fa-share-nodes"></i> <span>Export</span>
            </button>
            {showExportMenu && (
              <div className="absolute right-0 mt-3 w-56 bg-slate-800 border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-[60] animate-in fade-in zoom-in-95">
                <button onClick={downloadPdf} className="w-full p-4 flex items-center gap-4 hover:bg-white/5 text-left transition-colors border-b border-white/5">
                  <div className="w-8 h-8 rounded-lg bg-red-500/20 flex items-center justify-center text-red-400"><i className="fas fa-file-pdf"></i></div>
                  <span className="text-xs font-bold">PDF Document</span>
                </button>
                <button onClick={() => { setShowApkModal(true); setShowExportMenu(false); }} className="w-full p-4 flex items-center gap-4 hover:bg-white/5 text-left transition-colors">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center text-emerald-400"><i className="fab fa-android"></i></div>
                  <span className="text-xs font-bold">Android APK</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 flex relative">
        <aside className={`absolute lg:static inset-y-0 left-0 w-full lg:w-[360px] bg-[#1e293b] border-r border-white/5 shadow-2xl transition-transform duration-300 z-40 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
          <div className="p-6 space-y-8 overflow-y-auto h-full scrollbar-hide">
            {/* Tool Selection */}
            <section>
              <p className="text-[8px] font-black text-slate-500 uppercase tracking-[0.3em] mb-4">Workspace Mode</p>
              <div className="grid grid-cols-3 gap-2 bg-slate-900/50 p-1 rounded-2xl">
                {(['ai', 'text', 'rect'] as ToolMode[]).map(tool => (
                  <button key={tool} onClick={() => {setActiveTool(tool); setSelection(null);}} className={`py-4 rounded-xl flex flex-col items-center gap-2 transition-all ${activeTool === tool ? 'bg-indigo-600 text-white shadow-xl scale-100' : 'text-slate-500 hover:text-white hover:bg-white/5 scale-95'}`}>
                    <i className={`fas ${tool === 'ai' ? 'fa-robot' : tool === 'text' ? 'fa-font' : 'fa-vector-square'} text-xs`}></i>
                    <span className="text-[7px] font-black uppercase tracking-widest">{tool}</span>
                  </button>
                ))}
              </div>
            </section>

            {/* AI PANEL: EXCLUSIVE TO NEURAL INPUT */}
            {activeTool === 'ai' && (
              <section className="bg-slate-900/40 p-6 rounded-[2rem] border border-white/5 space-y-4 animate-in fade-in slide-in-from-bottom-4">
                <div className="flex items-center justify-between">
                  <p className="text-[8px] font-black text-indigo-400 uppercase tracking-widest">Neural Architect</p>
                  <div className={`w-2 h-2 rounded-full bg-indigo-500 ${isProcessing ? 'animate-ping' : ''}`}></div>
                </div>
                <textarea 
                  value={command}
                  onChange={e => setCommand(e.target.value)}
                  disabled={isProcessing}
                  placeholder="Tell the AI what to change... e.g. 'Replace the main header with Architect Labs LLC' or 'Make the footer text larger and bold'."
                  className="w-full h-32 bg-transparent text-[11px] font-medium resize-none focus:outline-none placeholder:text-slate-700 leading-relaxed disabled:opacity-50 border-none p-0"
                />
                <button 
                  onClick={handleCommandExecution}
                  disabled={isProcessing || !pdfFile || !command.trim()}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 py-4 rounded-2xl font-black text-[9px] uppercase tracking-[0.2em] shadow-xl active:scale-95 transition-all disabled:opacity-50"
                >
                  {isProcessing ? 'Processing...' : 'Run Neural Prompt'}
                </button>
              </section>
            )}

            {/* MANUAL PANEL: EXCLUSIVE TO TEXT TOOL */}
            {activeTool === 'text' && (
              <section className="bg-slate-900/40 p-6 rounded-[2rem] border border-white/5 space-y-5 animate-in fade-in slide-in-from-bottom-4">
                <div className="flex items-center justify-between">
                  <p className="text-[8px] font-black text-emerald-400 uppercase tracking-widest">Manual Text Overwrite</p>
                  <i className="fas fa-keyboard text-[10px] text-emerald-500/30"></i>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="text-[7px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">Original Content</label>
                    <input 
                      type="text" 
                      value={manualText.target}
                      onChange={e => setManualText({...manualText, target: e.target.value})}
                      placeholder="Draw selection on PDF..."
                      className="w-full bg-slate-950/50 border border-white/5 px-4 py-3 rounded-xl text-[10px] font-medium focus:outline-none focus:border-emerald-500 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="text-[7px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">New Content</label>
                    <input 
                      type="text" 
                      value={manualText.replacement}
                      onChange={e => setManualText({...manualText, replacement: e.target.value})}
                      placeholder="Type replacement text..."
                      className="w-full bg-slate-950/50 border border-white/5 px-4 py-3 rounded-xl text-[10px] font-medium focus:outline-none focus:border-emerald-500 transition-colors"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[7px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">Font Px</label>
                      <input 
                        type="number" 
                        value={manualText.size}
                        onChange={e => setManualText({...manualText, size: parseInt(e.target.value)})}
                        className="w-full bg-slate-950/50 border border-white/5 px-4 py-3 rounded-xl text-[10px] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[7px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">Color</label>
                      <div className="flex items-center bg-slate-950/50 border border-white/5 px-3 py-1.5 rounded-xl">
                        <input type="color" value={manualText.color} onChange={e => setManualText({...manualText, color: e.target.value})} className="w-5 h-5 bg-transparent border-none cursor-pointer" />
                        <span className="text-[9px] font-mono ml-2 opacity-40 uppercase">{manualText.color}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <button 
                  onClick={handleManualEdit}
                  disabled={isProcessing || (!manualText.target && !manualText.replacement)}
                  className="w-full bg-emerald-600 text-white hover:bg-emerald-500 py-4 rounded-2xl font-black text-[9px] uppercase tracking-[0.2em] shadow-xl active:scale-95 transition-all"
                >
                  Apply Change
                </button>
              </section>
            )}

            {!pdfFile && (
              <label className="group block w-full bg-indigo-600 text-white p-8 rounded-[2.5rem] text-center cursor-pointer active:scale-95 transition-all shadow-2xl hover:bg-indigo-500">
                <div className="w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                  <i className="fas fa-file-arrow-up text-xl"></i>
                </div>
                <p className="font-black text-[10px] uppercase tracking-[0.3em]">Load Document</p>
                <input type="file" accept=".pdf" className="hidden" onChange={handleFileUpload} />
              </label>
            )}
          </div>
        </aside>

        {/* CANVAS WORKSPACE */}
        <main className="flex-1 bg-[#0f172a] overflow-auto flex items-start justify-center p-4 lg:p-16 relative scrollbar-hide">
          {pdfFile ? (
            <div className="relative shadow-[0_60px_100px_-20px_rgba(0,0,0,0.6)] rounded-sm bg-white ring-1 ring-white/5">
              <canvas 
                ref={canvasRef}
                onMouseDown={handleStart} onMouseMove={handleMove} onMouseUp={handleEnd}
                onTouchStart={handleStart} onTouchMove={handleMove} onTouchEnd={handleEnd}
                className={`block max-w-full ${activeTool === 'text' ? 'cursor-text' : 'cursor-crosshair'}`}
              />
              {selection && (
                <div 
                  className={`absolute border-2 pointer-events-none ring-1 ring-black/10 transition-all ${activeTool === 'ai' ? 'border-indigo-500 bg-indigo-500/5' : activeTool === 'text' ? 'border-emerald-500 bg-emerald-500/5' : 'border-amber-500 bg-amber-500/5'}`}
                  style={{ left: `${selection.x1}%`, top: `${selection.y1}%`, width: `${selection.x2 - selection.x1}%`, height: `${selection.y2 - selection.y1}%` }}
                >
                  <div className={`absolute -top-3 -left-3 w-8 h-8 bg-white border-2 rounded-full shadow-lg flex items-center justify-center text-[10px] font-black ${activeTool === 'ai' ? 'border-indigo-500 text-indigo-600' : 'border-emerald-500 text-emerald-600'}`}>
                    <i className={`fas ${activeTool === 'ai' ? 'fa-robot' : 'fa-font'}`}></i>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="m-auto text-center opacity-20">
              <i className="fas fa-file-pdf text-8xl mb-8"></i>
              <p className="font-black uppercase tracking-[0.8em] text-sm">Workspace Idle</p>
            </div>
          )}

          {pdfFile && (
             <div className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-slate-800/90 backdrop-blur-xl px-8 py-3 rounded-full border border-white/5 flex items-center gap-8 shadow-2xl z-40">
                <button onClick={() => {const np = Math.max(1, currentPage-1); setCurrentPage(np); renderPage(pdfFile, np);}} className="text-slate-500 hover:text-white transition-colors"><i className="fas fa-chevron-left text-[10px]"></i></button>
                <div className="text-center min-w-[60px]">
                  <span className="text-[10px] font-black tabular-nums">{currentPage} <span className="opacity-20 mx-1">/</span> {pdfMetadata?.pageCount}</span>
                </div>
                <button onClick={() => {const np = Math.min(pdfMetadata!.pageCount, currentPage+1); setCurrentPage(np); renderPage(pdfFile, np);}} className="text-slate-500 hover:text-white transition-colors"><i className="fas fa-chevron-right text-[10px]"></i></button>
             </div>
          )}
        </main>
      </div>

      {/* APK BUILD CENTER */}
      {showApkModal && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-2xl z-[100] flex items-center justify-center p-6">
          <div className="bg-[#1e293b] w-full max-w-xl rounded-[2.5rem] border border-white/5 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-10 space-y-8">
              <div className="text-center">
                <div className="w-20 h-20 bg-emerald-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6 text-emerald-400 rotate-6 shadow-xl">
                  <i className="fab fa-android text-4xl"></i>
                </div>
                <h3 className="text-2xl font-black tracking-tighter uppercase">Native Build System</h3>
                <div className="flex justify-center gap-2 mt-6">
                  <button onClick={() => setApkModalTab('terminal')} className={`px-5 py-2 rounded-full text-[8px] font-black uppercase tracking-widest transition-all ${apkModalTab === 'terminal' ? 'bg-indigo-600' : 'bg-slate-800 text-slate-500'}`}>Terminal</button>
                  <button onClick={() => setApkModalTab('studio')} className={`px-5 py-2 rounded-full text-[8px] font-black uppercase tracking-widest transition-all ${apkModalTab === 'studio' ? 'bg-indigo-600' : 'bg-slate-800 text-slate-500'}`}>Studio</button>
                </div>
              </div>

              {apkModalTab === 'terminal' ? (
                <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
                  <p className="text-slate-400 text-[10px] font-bold text-center uppercase tracking-widest">Automation Script</p>
                  <div className="bg-black/50 p-6 rounded-2xl font-mono text-[11px] border border-white/5 relative">
                    <p className="text-indigo-400 mb-2"># Run this in PowerShell</p>
                    <p className="text-slate-300">./build-apk.ps1</p>
                    <button onClick={() => {navigator.clipboard.writeText("./build-apk.ps1"); setStatusMessage("Copied!");}} className="absolute top-4 right-4 text-slate-600 hover:text-white"><i className="fas fa-copy"></i></button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4 animate-in fade-in slide-in-from-left-4 bg-slate-800/50 p-6 rounded-2xl">
                  <p className="text-xs font-medium text-slate-300">1. Open the <span className="text-white font-bold">android</span> folder in Android Studio.</p>
                  <p className="text-xs font-medium text-slate-300">2. Wait for <span className="text-indigo-400 font-bold">Gradle Sync</span> to finish.</p>
                  <p className="text-xs font-medium text-slate-300">3. Select <span className="text-white font-bold">Build > Build APK(s)</span>.</p>
                </div>
              )}
              <button onClick={() => setShowApkModal(false)} className="w-full bg-white text-slate-950 py-5 rounded-2xl font-black uppercase tracking-[0.3em] text-[10px] active:scale-95 transition-all">Close Pipeline</button>
            </div>
          </div>
        </div>
      )}

      {statusMessage && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[110] animate-in slide-in-from-bottom-12">
           <div className="bg-indigo-600 text-white px-10 py-3 rounded-full shadow-2xl flex items-center gap-4 ring-2 ring-white/10">
              <i className="fas fa-bolt text-[10px] animate-pulse"></i>
              <span className="text-[9px] font-black uppercase tracking-[0.2em]">{statusMessage}</span>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;
