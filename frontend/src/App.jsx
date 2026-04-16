import { useState, useRef } from 'react';
import axios from 'axios';
import { UploadCloud, Activity, ChevronRight, FileText, Info, AlertCircle, CheckCircle2, AlertTriangle } from 'lucide-react';
import { syndromeData } from './syndromes';

// Railway Production URL
const API_URL = "https://genomex-medical-project-production.up.railway.app"; 

export default function App() {
  const [view, setView] = useState('landing'); 
  const [items, setItems] = useState([]); 
  const [isProcessingBulk, setIsProcessingBulk] = useState(false);
  const fileInputRef = useRef(null);

  const pendingCount = items.filter(i => i.status === 'pending' || i.status === 'analyzing').length;
  const totalCount = items.length;

  const handleFileUpload = async (e) => {
    // Limit to 50 files
    const files = Array.from(e.target.files).slice(0, 50);
    if (files.length === 0) return;

    // Convert to Base64 and setup initial state
    const newItems = await Promise.all(files.map(async (file) => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve({
                id: Math.random().toString(36).substr(2, 9),
                image: reader.result,
                status: 'pending', 
                label: null,
                confidence: null,
                explanation: null,
                isExplaining: false
            });
            reader.readAsDataURL(file);
        });
    }));

    setItems(prev => [...newItems, ...prev]);
    processQueue(newItems);
  };

  const processQueue = async (itemsToProcess) => {
    setIsProcessingBulk(true);
    const chunkSize = 5; // Process 3 at a time

    for (let i = 0; i < itemsToProcess.length; i += chunkSize) {
        const chunk = itemsToProcess.slice(i, i + chunkSize);
        
        await Promise.all(chunk.map(async (item) => {
            setItems(prev => prev.map(p => p.id === item.id ? {...p, status: 'analyzing'} : p));
            
            try {
                const response = await axios.post(`${API_URL}/analyze`, { image_base64: item.image });
                setItems(prev => prev.map(p => p.id === item.id ? {
                    ...p, 
                    status: 'done', 
                    label: response.data.label, 
                    confidence: response.data.confidence
                } : p));
            } catch (error) {
                console.error(error);
                setItems(prev => prev.map(p => p.id === item.id ? {...p, status: 'error'} : p));
            }
        }));
    }
    setIsProcessingBulk(false);
  };

  const getExplanation = async (id, label) => {
    setItems(prev => prev.map(p => p.id === id ? {...p, isExplaining: true} : p));
    try {
        const syndromeName = syndromeData[label]?.title || label;
        const response = await axios.post(`${API_URL}/explain`, { syndrome_id: syndromeName });
        setItems(prev => prev.map(p => p.id === id ? {...p, explanation: response.data.explanation, isExplaining: false} : p));
    } catch (error) {
        setItems(prev => prev.map(p => p.id === id ? {...p, isExplaining: false, explanation: "Ошибка сервера при генерации отчета."} : p));
    }
  };

  return (
    <div className="min-h-screen flex flex-col font-sans bg-slate-50">
      <nav className="bg-white shadow-sm px-6 py-4 flex justify-between items-center sticky top-0 z-50">
        <div className="text-2xl font-bold text-blue-600 flex items-center gap-2 cursor-pointer" onClick={() => setView('landing')}>
          <Activity size={28} /> GenomeX
        </div>
        <div className="flex gap-6 text-sm font-medium text-slate-600">
          <button onClick={() => setView('app')} className={`hover:text-blue-600 transition ${view === 'app' ? 'text-blue-600' : ''}`}>Воркспейс</button>
          <button onClick={() => setView('about')} className={`hover:text-blue-600 transition ${view === 'about' ? 'text-blue-600' : ''}`}>О нас</button>
          <button onClick={() => setView('future')} className={`hover:text-blue-600 transition ${view === 'future' ? 'text-blue-600' : ''}`}>Будущее проекта</button>
        </div>
      </nav>

      <div className="flex-1 flex flex-col">
        {view === 'landing' && (
            <div className="flex-1 flex items-center justify-center bg-[url('https://images.unsplash.com/photo-1530026405186-ed1f139313f8?q=80&w=2000&auto=format&fit=crop')] bg-cover bg-center relative">
                <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"></div>
                <div className="relative z-10 text-center max-w-3xl text-white px-6">
                    <h1 className="text-5xl md:text-6xl font-extrabold mb-6 tracking-tight">Будущее генетического скрининга.</h1>
                    <p className="text-xl md:text-2xl mb-10 text-slate-300 font-light">
                        Интеллектуальный анализ кариотипов с использованием YOLOv8 и LLM. Массовая диагностика до 50 снимков за сессию.
                    </p>
                    <button onClick={() => setView('app')} className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 px-10 rounded-full text-lg transition flex items-center gap-3 mx-auto shadow-lg shadow-blue-600/30">
                        Начать скрининг <ChevronRight />
                    </button>
                </div>
            </div>
        )}

        {view === 'app' && (
            <div className="p-4 md:p-8 max-w-7xl mx-auto w-full">
                
                {/* Medical Disclaimer */}
                <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-xl mb-6 flex gap-3 text-sm font-medium items-start">
                    <AlertTriangle className="shrink-0 mt-0.5 text-red-600" size={18} />
                    <p>
                        <strong>ВНИМАНИЕ:</strong> GenomeX является исследовательским инструментом. Результаты анализа формируются искусственным интеллектом, не являются окончательным медицинским диагнозом и требуют обязательной верификации врачом-генетиком.
                    </p>
                </div>

                {/* Upload Header */}
                <div className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border mb-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800">Массовый анализ</h2>
                        <p className="text-slate-500 text-sm mt-1">Загрузите до 50 фотографий кариотипов (JPEG/PNG)</p>
                    </div>
                    
                    <div className="flex items-center gap-4 w-full md:w-auto">
                        {isProcessingBulk && (
                            <div className="flex items-center gap-2 text-blue-600 font-medium bg-blue-50 px-4 py-2 rounded-full text-sm shrink-0">
                                <Activity size={16} className="animate-spin" /> В очереди: {pendingCount}
                            </div>
                        )}
                        <button 
                            onClick={() => fileInputRef.current.click()}
                            className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-6 rounded-xl transition flex items-center justify-center gap-2 w-full md:w-auto"
                        >
                            <UploadCloud size={20} /> Загрузить
                        </button>
                        <input type="file" multiple ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept="image/*" />
                    </div>
                </div>

                {/* Grid Results */}
                {totalCount > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {items.map(item => (
                            <div key={item.id} className="bg-white rounded-xl shadow-sm border overflow-hidden flex flex-col transition hover:shadow-md">
                                <div className="h-40 bg-slate-100 relative">
                                    <img src={item.image} alt="karyotype" className="w-full h-full object-cover" />
                                    
                                    {item.status === 'pending' && (
                                        <div className="absolute inset-0 bg-slate-900/50 flex flex-col items-center justify-center text-white text-sm font-medium">Ожидание...</div>
                                    )}
                                    {item.status === 'analyzing' && (
                                        <div className="absolute inset-0 bg-blue-900/60 flex flex-col items-center justify-center text-white text-sm font-medium backdrop-blur-sm">
                                            <Activity size={24} className="animate-spin mb-2" /> Анализ YOLOv8...
                                        </div>
                                    )}
                                </div>

                                <div className="p-4 flex-1 flex flex-col">
                                    {item.status === 'error' && (
                                        <div className="text-red-500 flex items-center gap-2 text-sm"><AlertCircle size={16}/> Ошибка анализа</div>
                                    )}

                                    {item.status === 'done' && (
                                        <>
                                            <div className="flex justify-between items-start mb-2 gap-2">
                                                <div className="font-bold text-slate-800 leading-tight">
                                                    {syndromeData[item.label]?.title || "Неизвестно"}
                                                </div>
                                                <div className="text-xs font-bold text-emerald-700 bg-emerald-100 px-2 py-1 rounded shrink-0">
                                                    {(item.confidence * 100).toFixed(1)}%
                                                </div>
                                            </div>
                                            
                                            {!item.explanation && (
                                                <p className="text-xs text-slate-500 mb-4 line-clamp-2 flex-1">
                                                    {syndromeData[item.label]?.desc}
                                                </p>
                                            )}

                                            {item.explanation ? (
                                                <div className="mt-auto bg-slate-50 p-3 rounded-lg border border-blue-100 text-xs text-slate-700 whitespace-pre-wrap">
                                                    <div className="font-semibold flex items-center gap-1 mb-1 text-blue-800"><CheckCircle2 size={14}/> ИИ-Заключение:</div>
                                                    {item.explanation}
                                                    </div>
                                            ) : item.label === 'not_karyotype' ? (
                                                <div className="mt-auto w-full py-2 bg-slate-100 text-slate-400 font-medium rounded-lg text-sm flex justify-center items-center gap-2 border border-slate-200">
                                                    <AlertCircle size={16} /> Анализ невозможен
                                                </div>
                                            ) : (
                                                <button 
                                                    onClick={() => getExplanation(item.id, item.label)}
                                                    disabled={item.isExplaining}
                                                    className="mt-auto w-full py-2 bg-slate-100 hover:bg-blue-50 text-blue-600 font-medium rounded-lg text-sm transition flex justify-center items-center gap-2"
                                                >
                                                    {item.isExplaining ? <Activity size={16} className="animate-spin" /> : <Info size={16} />}
                                                    {item.isExplaining ? "Генерация..." : "Клинический отчет"}
                                                </button>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-24 bg-white rounded-2xl border border-dashed border-slate-300">
                        <FileText size={48} className="mx-auto text-slate-300 mb-4" />
                        <h3 className="text-xl font-medium text-slate-700">Рабочая область пуста</h3>
                        <p className="text-slate-500 mt-2 text-sm">Загрузите изображения для начала скрининга.</p>
                    </div>
                )}
            </div>
        )}

        {view === 'about' && (
            <div className="p-8 max-w-3xl mx-auto w-full mt-10">
                <h1 className="text-4xl font-bold text-slate-800 mb-6">О проекте GenomeX</h1>
                <div className="prose prose-slate prose-lg">
                    <p className="mb-4 text-slate-600 leading-relaxed">
                        <strong>GenomeX</strong> — это исследовательский проект на стыке медицины и глубокого машинного обучения. Наша цель — автоматизировать рутинный процесс визуального анализа хромосом (кариотипирования), снизить влияние человеческого фактора и ускорить постановку предварительных диагнозов.
                    </p>
                    <p className="mb-4 text-slate-600 leading-relaxed">
                        В основе системы лежит архитектура компьютерного зрения <strong>YOLOv8</strong>, оптимизированная для детекции хромосомных аномалий. Для интерпретации результатов используется интеграция с Большими Языковыми Моделями (LLM), которые формируют структурированные клинические отчеты.
                    </p>
                    <p className="text-slate-600 leading-relaxed">
                        Проект разработан для участия в медицинских и технологических олимпиадах как концепт будущего цифровой лаборатории.
                    </p>
                </div>
            </div>
        )}

        {view === 'future' && (
            <div className="p-8 max-w-3xl mx-auto w-full mt-10">
                <h1 className="text-4xl font-bold text-slate-800 mb-6">Вектор развития</h1>
                <div className="space-y-6">
                    <div className="bg-white p-6 rounded-xl border shadow-sm">
                        <h3 className="text-xl font-bold text-slate-800 mb-2">📱 Мобильное приложение</h3>
                        <p className="text-slate-600">Разработка кроссплатформенного приложения для врачей, позволяющего делать скрининг прямо со смартфона через окуляр микроскопа.</p>
                    </div>
                    <div className="bg-white p-6 rounded-xl border shadow-sm">
                        <h3 className="text-xl font-bold text-slate-800 mb-2">🏥 Интеграция с ЛИС (DICOM)</h3>
                        <p className="text-slate-600">Поддержка медицинского стандарта DICOM для прямой выгрузки снимков из лабораторных информационных систем больниц.</p>
                    </div>
                    <div className="bg-white p-6 rounded-xl border shadow-sm">
                        <h3 className="text-xl font-bold text-slate-800 mb-2">🧠 Расширение датасета</h3>
                        <p className="text-slate-600">Обучение нейросети на выявление более редких микроделеций и транслокаций, помимо основных трисомий.</p>
                    </div>
                </div>
            </div>
        )}
      </div>
    </div>
  );
}