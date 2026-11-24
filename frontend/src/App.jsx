import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Activity, AlertCircle, ChevronRight, UploadCloud } from 'lucide-react';

const API_URL = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const SAMPLE_URL = `${import.meta.env.BASE_URL}sample-trisomy-21.jpg`;
const SAMPLE_SOURCE = 'https://wellcomecollection.org/works/wmcdanw6';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const labels = {
  down_syndrome: 'Синдром Дауна',
  edwards_syndrome: 'Синдром Эдвардса',
  patau_syndrome: 'Синдром Патау',
};

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Не удалось прочитать изображение.'));
    reader.readAsDataURL(file);
  });
}

function inferenceError(error) {
  switch (error.response?.status) {
    case 413: return 'Изображение превышает 5 МиБ или 12 мегапикселей.';
    case 422: return 'Загрузите читаемое изображение JPEG или PNG.';
    case 500: return 'Модель не смогла обработать изображение. Попробуйте снова.';
    default: return 'Сервис анализа недоступен. Попробуйте позже.';
  }
}

function ResultCard({ item }) {
  const prediction = item.prediction;

  return (
    <article className="rounded-xl border bg-white overflow-hidden">
      {item.preview && (
        <div className="relative bg-slate-100">
          <img src={item.preview} alt="Кариотип для анализа" className="block w-full h-auto" />
          {prediction?.detections.length > 0 && (
            <svg
              aria-hidden="true"
              viewBox={`0 0 ${prediction.width} ${prediction.height}`}
              className="absolute inset-0 w-full h-full"
            >
              {prediction.detections.map(({ box: [left, top, right, bottom] }, index) => (
                <g key={index}>
                  <rect x={left} y={top} width={right - left} height={bottom - top} fill="#0f766e" fillOpacity="0.16" stroke="#0f766e" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                  {prediction.detections.length > 1 && (
                    <text x={left} y={top} dominantBaseline="hanging" fill="#064e3b" stroke="white" strokeWidth="3" paintOrder="stroke" fontSize={prediction.width * 0.04} fontWeight="bold">{index + 1}</text>
                  )}
                </g>
              ))}
            </svg>
          )}
        </div>
      )}
      <div className="p-4">
        <h3 className="font-semibold break-words">{item.name}</h3>
        {item.sample && (
          <p className="text-sm text-slate-600">
            Wessex Reg. Genetics Centre · <a href={SAMPLE_SOURCE} className="text-blue-700 underline">Wellcome Collection</a>
            {' · '}<a href="https://creativecommons.org/licenses/by/4.0/" className="text-blue-700 underline">CC BY 4.0</a>
          </p>
        )}
        <div className="mt-3" aria-live="polite">
          {item.status === 'pending' && <p className="text-sm text-slate-600">В очереди</p>}
          {item.status === 'analyzing' && <p className="text-sm text-blue-700">Анализ изображения…</p>}
          {item.error && (
            <p className="flex items-start gap-2 text-sm text-red-700">
              <AlertCircle className="shrink-0" size={16} /> {item.error}
            </p>
          )}
          {prediction && (prediction.detections.length === 0 ? (
            <p className="text-sm text-slate-700">Модель не нашла областей выше порога уверенности. По этому результату нельзя судить о норме кариотипа.</p>
          ) : (
            <ul aria-label="Обнаруженные области" className="space-y-2">
              {prediction.detections.map(({ label, confidence }, index) => (
                <li key={index} className="flex flex-wrap items-baseline justify-between gap-x-3 rounded-lg bg-teal-50 px-3 py-2 text-sm">
                  <span className="font-semibold text-teal-950">
                    {prediction.detections.length > 1 && `${index + 1}. `}{labels[label] || label}
                  </span>
                  <span className="text-teal-800">{(confidence * 100).toFixed(1)}% · уверенность модели</span>
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>
    </article>
  );
}

export default function App() {
  const [view, setView] = useState('landing');
  const [items, setItems] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [sampleError, setSampleError] = useState('');
  const fileInputRef = useRef(null);
  const previews = useRef(new Set());

  useEffect(() => {
    const urls = previews.current;
    return () => urls.forEach(url => URL.revokeObjectURL(url));
  }, []);

  function updateItem(id, update) {
    setItems(previous => previous.map(item => item.id === id ? { ...item, ...update } : item));
  }

  function clearResults() {
    previews.current.forEach(url => URL.revokeObjectURL(url));
    previews.current.clear();
    setItems([]);
    setSampleError('');
  }

  async function processFiles(files, sample = false) {
    const batch = files.map(file => {
      const error = file.size > MAX_IMAGE_BYTES ? 'Изображение превышает 5 МиБ.' : '';
      const preview = error ? null : URL.createObjectURL(file);
      if (preview) previews.current.add(preview);
      return { id: crypto.randomUUID(), name: file.name, preview, sample, error, status: error ? 'error' : 'pending' };
    });
    setItems(previous => [...batch, ...previous]);

    for (const [index, file] of files.entries()) {
      const item = batch[index];
      if (item.error) continue;
      updateItem(item.id, { status: 'analyzing' });

      let image;
      try {
        image = await readImage(file);
      } catch (error) {
        updateItem(item.id, { status: 'error', error: error.message });
        continue;
      }

      try {
        const { data } = await axios.post(`${API_URL}/analyze`, { image_base64: image }, { timeout: 60_000 });
        if (!Array.isArray(data?.detections) || !data.width || !data.height) {
          updateItem(item.id, { status: 'error', error: 'Сервис вернул несовместимый формат результата.' });
          continue;
        }
        updateItem(item.id, { status: 'done', prediction: data });
      } catch (error) {
        updateItem(item.id, { status: 'error', error: inferenceError(error) });
      }
    }
  }

  async function handleFileUpload(event) {
    const files = Array.from(event.target.files).slice(0, 50);
    event.target.value = '';
    if (files.length === 0 || isProcessing) return;
    setIsProcessing(true);
    setSampleError('');
    try {
      await processFiles(files);
    } finally {
      setIsProcessing(false);
    }
  }

  async function trySample() {
    if (isProcessing) return;
    setIsProcessing(true);
    setSampleError('');
    try {
      const response = await fetch(SAMPLE_URL);
      if (!response.ok) throw new Error('Sample unavailable');
      const file = new File([await response.blob()], 'Пример кариотипа', { type: 'image/jpeg' });
      await processFiles([file], true);
    } catch {
      setSampleError('Не удалось загрузить пример. Попробуйте ещё раз.');
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col font-sans bg-slate-50">
      <nav aria-label="Навигация" className="bg-white shadow-sm px-4 sm:px-6 py-4 flex flex-wrap gap-4 justify-between items-center">
        <button type="button" className="text-2xl font-bold text-blue-700 flex items-center gap-2" onClick={() => setView('landing')}>
          <Activity size={28} /> GenomeX
        </button>
        <div className="flex flex-wrap gap-4 text-sm font-medium text-slate-700">
          <button type="button" onClick={() => setView('app')} aria-current={view === 'app' ? 'page' : undefined} className="hover:text-blue-700 aria-[current=page]:text-blue-700">Анализ</button>
          <button type="button" onClick={() => setView('about')} aria-current={view === 'about' ? 'page' : undefined} className="hover:text-blue-700 aria-[current=page]:text-blue-700">О проекте</button>
          <button type="button" onClick={() => setView('future')} aria-current={view === 'future' ? 'page' : undefined} className="hover:text-blue-700 aria-[current=page]:text-blue-700">Планы</button>
        </div>
      </nav>

      {view === 'landing' && (
        <main className="flex-1 flex items-center justify-center bg-slate-900 bg-[url('https://images.unsplash.com/photo-1530026405186-ed1f139313f8?q=80&w=2000&auto=format&fit=crop')] bg-cover bg-center relative">
          <div className="absolute inset-0 bg-slate-900/75 backdrop-blur-sm"></div>
          <div className="relative text-center max-w-3xl text-white px-6 py-12">
            <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight">Анализ изображений кариотипов</h1>
            <p className="text-lg md:text-xl my-6 text-slate-200">Исследовательское демо. YOLO11n отмечает области, которые модель связывает с тремя классами трисомий.</p>
            <button type="button" onClick={() => setView('app')} className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-6 rounded-full flex items-center gap-2 mx-auto">
              Открыть демо <ChevronRight size={20} />
            </button>
          </div>
        </main>
      )}

      {view === 'app' && (
        <main className="p-4 md:p-8 max-w-7xl mx-auto w-full">
          <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border mb-6">
            <h1 className="text-2xl font-bold">Исследовательское демо</h1>
            <p className="mt-2 text-sm text-slate-700">Только для демонстрации и исследований. Не загружайте данные пациентов. Оценки модели нельзя использовать для диагностики.</p>
            <p className="mt-2 text-sm text-slate-600">До 50 изображений за раз. JPEG или PNG, до 5 МиБ и 12 мегапикселей каждое.</p>
            <div className="mt-4 flex flex-col sm:flex-row flex-wrap gap-3">
              <button type="button" onClick={trySample} disabled={isProcessing} className="rounded-xl bg-blue-700 hover:bg-blue-800 disabled:opacity-50 px-5 py-3 font-semibold text-white">Попробовать пример</button>
              <button type="button" onClick={() => fileInputRef.current.click()} disabled={isProcessing} className="flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-5 py-3 font-semibold hover:bg-slate-100 disabled:opacity-50">
                <UploadCloud size={20} /> Загрузить изображения
              </button>
              <input type="file" multiple ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept="image/jpeg,image/png" />
              {items.length > 0 && (
                <button type="button" onClick={clearResults} disabled={isProcessing} className="px-3 py-3 text-sm font-medium text-slate-700 underline disabled:opacity-50">Очистить результаты</button>
              )}
            </div>
            {isProcessing && <p role="status" className="mt-3 text-sm text-blue-700">Обработка изображений…</p>}
            {sampleError && <p role="alert" className="mt-3 text-sm text-red-700">{sampleError}</p>}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 items-start">
            {items.map(item => <ResultCard key={item.id} item={item} />)}
          </div>
        </main>
      )}

      {view === 'about' && (
        <main className="p-4 md:p-8 max-w-3xl mx-auto w-full">
          <div className="bg-white p-6 rounded-2xl border">
            <h1 className="text-3xl font-bold mb-4">О проекте GenomeX</h1>
            <p className="text-slate-700">GenomeX — исследовательский проект по компьютерному зрению. FastAPI запускает модель обнаружения объектов на сервере, а React показывает рамки, классы и оценки уверенности модели.</p>
            <p className="mt-3 text-slate-700">Демо охватывает три класса. Модель может пропускать области и ошибаться при определении класса.</p>
          </div>
        </main>
      )}

      {view === 'future' && (
        <main className="p-4 md:p-8 max-w-3xl mx-auto w-full">
          <div className="bg-white p-6 rounded-2xl border">
            <h1 className="text-3xl font-bold mb-4">Планы проекта</h1>
            <p className="text-slate-700">Проверить ошибки на независимой выборке и сравнить версии модели на одних и тех же изображениях с одинаковыми метриками.</p>
          </div>
        </main>
      )}
    </div>
  );
}
