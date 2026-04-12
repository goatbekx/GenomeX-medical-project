import { useState, useRef } from 'react';
import axios from 'axios';
import { UploadCloud, Activity, ChevronRight, FileText, Info, AlertCircle, CheckCircle2 } from 'lucide-react';
import { syndromeData } from './syndromes';

const API_URL = "https://genomex-medical-project-production.up.railway.app"; 

export default function App() {
  const [view, setView] = useState('landing'); 
  const [items, setItems] = useState([]); // Массив всех карточек-снимков
  const [isProcessingBulk, setIsProcessingBulk] = useState(false);
  const fileInputRef = useRef(null);

  // Считаем прогресс для шапки
  const pendingCount = items.filter(i => i.status === 'pending' || i.status === 'analyzing').length;
  const totalCount = items.length;

  const handleFileUpload = async (e) => {
    // Берем файлы, обрезаем до 50 штук
    const files = Array.from(e.target.files).slice(0, 50);
    if (files.length === 0) return;

    // Конвертируем все в Base64
    const newItems = await Promise.all(files.map(async (file) => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve({
                id: Math.random().toString(36).substr(2, 9),
                image: reader.result,
                status: 'pending', // pending, analyzing, done, error
                label: null,
                confidence: null,
                explanation: null,
                isExplaining: false
            });
            reader.readAsDataURL(file);
        });
    }));

    // Добавляем новые элементы в начало списка
    setItems(prev => [...newItems, ...prev]);
    // Запускаем умную очередь
    processQueue(newItems);
  };

  // Умная очередь: обрабатываем по 3 фото за раз
  const processQueue = async (itemsToProcess) => {
    setIsProcessingBulk(true);
    const chunkSize = 3; 

    for (let i = 0; i < itemsToProcess.length; i += chunkSize) {
        const chunk = itemsToProcess.slice(i, i + chunkSize);
        
        await Promise.all(chunk.map(async (item) => {
            // Ставим статус "анализируем"
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
          <button onClick={() => setView('app')} className="hover:text-blue-600 transition">Воркспейс</button>
          <button onClick={() => setView('about')} className="hover:text-blue-600 transition">О нас</button>
          <button onClick={() => setView('future')} className="hover:text-blue-600 transition">Будущее проекта</button>
        </div>
      </nav>

      <div className="flex-1 flex flex-col">
        {view === 'landing' && (
            <div className="flex-1 flex items-center justify-center bg-[url('https://images.unsplash.com/photo-1530026405186-ed1f139313f8?q=80&w=2000&auto=format&fit=crop')] bg-cover bg-center">
                <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"></div>
                <div className="relative bg-white/10 backdrop-blur-md border border-white/20 p-12 rounded-2xl text-center max-w-2xl text-white shadow-2xl">
                    <h1 className="text-5xl font-extrabold mb-4">Мгновенный скрининг кариотипа.</h1>
                    <p className="text-xl mb-8 text-slate-200">Массовая диагностика до 50 снимков за сессию. Архитектура YOLOv8 и LLM-отчеты.</p>
                    <button onClick={() => setView('app')} className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-8 rounded-full text-lg transition flex items-center gap-2 mx-auto">
                        Начать анализ <ChevronRight />
                    </button>
                </div>
            </div>
        )}

        {view === 'app' && (
            <div className="p-8 max-w-7xl mx-auto w-full">
                {/* Зона загрузки и Статус */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border mb-8 flex items-center justify-between">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800">Массовый анализ</h2>
                        <p className="text-slate-500 text-sm mt-1">Загрузите до 50 фотографий кариотипов (JPEG/PNG)</p>
                    </div>
                    
                    <div className="flex items-center gap-4">
                        {isProcessingBulk && (
                            <div className="flex items-center gap-2 text-blue-600 font-medium bg-blue-50 px-4 py-2 rounded-full">
                                <Activity size={18} className="animate-spin" /> Обработка: осталось {pendingCount}
                            </div>
                        )}
                        <button 
                            onClick={() => fileInputRef.current.click()}
                            className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-6 rounded-xl transition flex items-center gap-2"
                        >
                            <UploadCloud size={20} /> Загрузить снимки
                        </button>
                        <input type="file" multiple ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept="image/*" />
                    </div>
                </div>

                {/* Сетка результатов */}
                {totalCount > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {items.map(item => (
                            <div key={item.id} className="bg-white rounded-xl shadow-sm border overflow-hidden flex flex-col">
                                <div className="h-48 bg-slate-100 relative">
                                    <img src={item.image} alt="karyotype" className="w-full h-full object-cover" />
                                    
                                    {/* Бейджи статуса поверх картинки */}
                                    {item.status === 'pending' && (
                                        <div className="absolute inset-0 bg-slate-900/50 flex flex-col items-center justify-center text-white font-medium">
                                            Ожидание в очереди...
                                        </div>
                                    )}
                                    {item.status === 'analyzing' && (
                                        <div className="absolute inset-0 bg-blue-900/60 flex flex-col items-center justify-center text-white font-medium">
                                            <Activity size={32} className="animate-spin mb-2" /> Анализ YOLOv8...
                                        </div>
                                    )}
                                </div>

                                <div className="p-5 flex-1 flex flex-col">
                                    {item.status === 'error' && (
                                        <div className="text-red-500 flex items-center gap-2"><AlertCircle size={18}/> Ошибка сервера</div>
                                    )}

                                    {item.status === 'done' && (
                                        <>
                                            <div className="flex justify-between items-start mb-2">
                                                <div className="font-bold text-lg text-slate-800 leading-tight">
                                                    {syndromeData[item.label]?.title || "Неизвестно"}
                                                </div>
                                                <div className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded">
                                                    {(item.confidence * 100).toFixed(1)}%
                                                </div>
                                            </div>
                                            
                                            <p className="text-sm text-slate-600 mb-4 flex-1">
                                                {syndromeData[item.label]?.desc}
                                            </p>

                                            {/* Блок отчета ИИ */}
                                            {item.explanation ? (
                                                <div className="mt-auto bg-slate-50 p-3 rounded-lg border text-xs text-slate-700 whitespace-pre-wrap">
                                                    <div className="font-semibold flex items-center gap-1 mb-2 text-slate-800"><CheckCircle2 size={14}/> Клиническое заключение:</div>
                                                    {item.explanation}
                                                </div>
                                            ) : (
                                                <button 
                                                    onClick={() => getExplanation(item.id, item.label)}
                                                    disabled={item.isExplaining}
                                                    className="mt-auto w-full py-2 bg-slate-100 hover:bg-blue-50 text-blue-600 font-medium rounded-lg text-sm transition flex justify-center items-center gap-2"
                                                >
                                                    {item.isExplaining ? <Activity size={16} className="animate-spin" /> : <Info size={16} />}
                                                    {item.isExplaining ? "Генерация..." : "Глубокий анализ"}
                                                </button>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-slate-300">
                        <FileText size={48} className="mx-auto text-slate-300 mb-4" />
                        <h3 className="text-xl font-medium text-slate-700">Воркспейс пуст</h3>
                        <p className="text-slate-500 mt-2">Загрузите изображения для начала потокового анализа.</p>
                    </div>
                )}
            </div>
        )}
      </div>
    </div>
  );
}