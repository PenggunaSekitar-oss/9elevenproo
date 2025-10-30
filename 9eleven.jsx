import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
Search,
AlertCircle,
Copy,
Check,
Sparkles,
RotateCcw,
Download,
Image as ImageIcon,
XCircle,
Clapperboard,
Film,
Lightbulb,
X,
PlayCircle,
Archive,
Save,
Trash2,
Clock,
Mic,
PenSquare,
LayoutGrid,
TrendingUp,
Settings,
Info,
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInAnonymously, signInWithCustomToken } from 'firebase/auth';
import {
getFirestore,
collection,
query,
onSnapshot,
addDoc,
serverTimestamp,
doc,
deleteDoc,
setLogLevel,
setDoc
} from 'firebase/firestore';


const apiKey = "";
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;

const getLangInfo = (countryString) => {
const match = countryString.match(/\((.*?)\)/);
const code = match ? match[1] : 'id-ID';

const languageMap = {
'id-ID': 'Indonesian', 'en-US': 'English', 'en-GB': 'English', 'ja-JP': 'Japanese',
'ko-KR': 'Korean', 'hi-IN': 'Hindi', 'es-ES': 'Spanish', 'fr-FR': 'French',
'de-DE': 'German', 'ru-RU': 'Russian', 'pt-BR': 'Portuguese', 'ar-SA': 'Arabic',
'zh-CN': 'Mandarin Chinese'
};

const languageNameForPrompt = languageMap[code] || 'Indonesian';
return { code, languageNameForPrompt, langCode: code || 'id-ID' };
};

function buildCuePointsFromSegments(visuals, totalDuration) {
  
  const scriptSegments = visuals.map(v => v.scriptSegment || "");
  
  const charCounts = scriptSegments.map(seg => seg.trim().length);
  const totalChars = charCounts.reduce((a, b) => a + b, 0) || 1;
  
  let durations = charCounts.map(chars => (chars / totalChars) * totalDuration);

  
  const actualTotal = durations.reduce((a, b) => a + b, 0);
  if (actualTotal > 0 && Math.abs(actualTotal - totalDuration) > 0.001) {
    durations = durations.map(d => (d / actualTotal) * totalDuration);
  }

  
  const cuePoints = [0];
  for (let i = 0; i < durations.length - 1; i++) {
    cuePoints.push(cuePoints[i] + durations[i]);
  }
  return { cuePoints, durations };
}

function upperBound(arr, x) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function drawContain(ctx, img, cw, ch) {
  const iw = img.width, ih = img.height;
  const ca = cw / ch;
  const ia = iw / ih;
  let rw, rh, x, y;

  if (ia > ca) {
    rw = cw;
    rh = rw / ia;
    x = 0;
    y = (ch - rh) / 2;
  } else {
    rh = ch;
    rw = rh * ia;
    x = (cw - rw) / 2;
    y = 0;
  }
  
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, cw, ch);
  
  ctx.drawImage(img, x, y, rw, rh);
}


async function preloadImages(urls) {
  return Promise.all(
    urls.map(
      url =>
        new Promise((resolve, reject) => {
          if (!url) { resolve(null); return; }
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error(`Gagal memuat: ${url}`));
          img.src = url;
        })
    )
  );
}

function drawSubtitle(ctx, text, cw, ch) {
    if (!text || text.trim() === '') return;

    const textToDraw = text.trim().replace(/^(pertama|kedua|ketiga|keempat|kelima|keenam|ketujuh|selanjutnya|terakhir)[\.,:]?\s*/i, '');
    
    if (textToDraw === '') return;

    const fontSize = 52;
    const fontFamily = "Poppins, sans-serif";
    const lineHeight = fontSize * 1.2;
    const bottomMargin = ch * 0.1; 
    const maxWidth = cw * 0.9;
    const x = cw / 2;

    ctx.font = `bold ${fontSize}px ${fontFamily}`;
    ctx.textAlign = "center";
    ctx.fillStyle = "white";
    ctx.strokeStyle = "black";
    ctx.lineWidth = 8;
    ctx.lineJoin = "round";
    
    ctx.textBaseline = "bottom"; 

    const words = textToDraw.split(' ');
    let lines = [];
    let currentLine = '';

    for (let i = 0; i < words.length; i++) {
        let testLine = currentLine + words[i] + ' ';
        if (ctx.measureText(testLine).width > maxWidth && i > 0) {
            lines.push(currentLine.trim());
            currentLine = words[i] + ' ';
        } else {
            currentLine = testLine;
        }
    }
    lines.push(currentLine.trim());
    
    
    if (lines.length > 2) {
        lines = lines.slice(0, 2);
    }
    
    
    let totalHeight = lines.length * lineHeight;
    let startY = ch - bottomMargin; 

    for (let i = 0; i < lines.length; i++) {
        const line = lines[lines.length - 1 - i]; 
        const y = startY - (i * lineHeight);
        
        
        ctx.strokeText(line, x, y);
        ctx.fillText(line, x, y);
    }
}


async function handleGeneratePreviewSync({ audioUrl, scriptVisuals, aspectRatio = "9:16" }) {
  if (!audioUrl) throw new Error("Audio belum tersedia.");
  if (!scriptVisuals?.length) {
    throw new Error("Visual harus tersedia sebelum membuat pratinjau.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext("2d", { alpha: false });

  const audio = new Audio(audioUrl);
  audio.preload = "auto";

  await new Promise((resolve, reject) => {
    audio.onloadedmetadata = () => resolve();
    audio.onerror = () => reject(new Error("Gagal memuat metadata audio."));
  });

  const totalDuration = audio.duration;
  if (!Number.isFinite(totalDuration) || totalDuration <= 0) {
    throw new Error("Durasi audio tidak valid.");
  }

  const images = await preloadImages(scriptVisuals.map(v => v.imageUrl));
  const { cuePoints } = buildCuePointsFromSegments(scriptVisuals, totalDuration);

  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const mediaSource = audioContext.createMediaElementSource(audio);
  const dest = audioContext.createMediaStreamDestination();
  mediaSource.connect(dest);
  mediaSource.connect(audioContext.destination);

  const fps = 30;
  const interval = 1000 / fps; 
  
  const videoStream = canvas.captureStream(fps);
  const videoTrack = videoStream.getVideoTracks()[0];
  const audioTrack = dest.stream.getAudioTracks()[0];
  const mixedStream = new MediaStream([videoTrack, audioTrack]);

  const recorder = new MediaRecorder(mixedStream, { mimeType: "video/webm" });
  const chunks = [];
  recorder.ondataavailable = e => e.data?.size && chunks.push(e.data);

  recorder.start();

  let intervalId;
  
  await new Promise((resolve) => {
    const onPlaying = () => {
      audio.removeEventListener("playing", onPlaying);
      resolve();
    };
    audio.addEventListener("playing", onPlaying);
    audio.play();
  });

  ctx.fillStyle = "black";
  const cw = canvas.width, ch = canvas.height;

  const render = () => {
    const t = audio.currentTime;
    
    
    if (audio.ended) {
        clearInterval(intervalId);
        if (recorder.state === "recording") recorder.stop();
        return;
    }
    
    let idx = upperBound(cuePoints, t) - 1;
    if (idx < 0) idx = 0;
    if (idx >= images.length) idx = images.length - 1;

    ctx.fillRect(0, 0, cw, ch);

    const visual = scriptVisuals[idx];
    const img = images[idx];

    if (visual && img) {
      drawContain(ctx, img, cw, ch);
    } else if (visual && visual.is_cta) {
        if (img) {
            drawContain(ctx, img, cw, ch);
        } else {
            ctx.fillStyle = '#0f172a';
            ctx.fillRect(0, 0, cw, ch);
            const fontFamily = "Poppins, sans-serif";
            ctx.font = `bold 60px ${fontFamily}`;
            ctx.fillStyle = 'white';
            ctx.textAlign = "center";
            ctx.fillText('LAYAR AJAKAN', cw / 2, ch / 2 - 40);
            ctx.font = `30px ${fontFamily}`;
            ctx.fillStyle = '#94a3b8';
            ctx.fillText('(Like & Subscribe)', cw / 2, ch / 2 + 40);
        }
    }

    if (visual && visual.scriptSegment && !visual.is_cta) {
      drawSubtitle(ctx, visual.scriptSegment, cw, ch);
    }

  };

  
  intervalId = setInterval(render, interval);

  const stopPromise = new Promise(resolve => {
    
    audio.onended = () => {
      clearInterval(intervalId);
      if (recorder.state === "recording") recorder.stop();
    };
    recorder.onstop = () => resolve();
  });

  await stopPromise;

  const blob = new Blob(chunks, { type: "video/webm" });
  videoStream.getTracks().forEach(t => t.stop());
  dest.stream.getAudioTracks().forEach(t => t.stop());
  audioContext.close();

  return URL.createObjectURL(blob);
}


const fetchWithRetry = async (url, options, maxRetries = 5) => {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      const response = await fetch(url, options);
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`API Error with status: ${response.status}`);
      }
      return response;
    } catch (error) {
      attempt++;
      if (attempt >= maxRetries) {
        console.error(`Gagal melakukan request ke ${url} setelah ${maxRetries} percobaan.`, error);
        throw error;
      }
      const delay = Math.pow(2, attempt) * 100 + Math.random() * 100;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error("Gagal melakukan request setelah beberapa kali percobaan.");
};

const TopicInput = ({ topic, onTopicChange, inputRef, placeholder }) => {
  const handleChange = (e) => {
    onTopicChange(e.target.value);
  };

  return (
    <input
      ref={inputRef}
      type="text"
      placeholder={placeholder}
      value={topic}
      onChange={handleChange}
      className="w-full px-4 py-2.5 bg-white dark:bg-zinc-700/50 border border-zinc-300 dark:border-zinc-700 rounded-xl focus:ring-4 focus:ring-blue-500/30 focus:border-blue-500 transition shadow-ui"
    />
  );
};


const MemoizedTopicInput = React.memo(TopicInput, (prevProps, nextProps) => {
  return prevProps.topic === nextProps.topic &&
         prevProps.placeholder === nextProps.placeholder;
});


const SearchInput = ({ query, onQueryChange, placeholder }) => {
  const handleChange = (e) => {
    onQueryChange(e.target.value);
  };

  return (
    <input
      type="text"
      placeholder={placeholder}
      value={query}
      onChange={handleChange}
      className="w-full px-3 py-1.5 bg-zinc-100 dark:bg-zinc-700 border-zinc-300 dark:border-zinc-600 rounded-md focus:ring-1 focus:ring-blue-500 text-sm shadow-inner"
    />
  );
};
const MemoizedSearchInput = React.memo(SearchInput);


const ScriptTextarea = ({ script, onScriptChange, textareaRef, placeholder }) => {
  const handleChange = (e) => {
    onScriptChange(e.target.value);
  };

  return (
    <textarea
      ref={textareaRef}
      value={script}
      onChange={handleChange}
      className="script-textarea w-full h-64 bg-zinc-100 dark:bg-zinc-800/50 p-4 rounded-xl mb-4 text-zinc-700 dark:text-zinc-300 text-sm leading-relaxed whitespace-pre-wrap focus:ring-2 focus:ring-blue-500 focus:border-transparent transition border border-zinc-200 dark:border-zinc-700 shadow-inner"
      placeholder={placeholder}
    />
  );
};
const MemoizedScriptTextarea = React.memo(ScriptTextarea);


const MinimalSpinner = ({ size = 20, color = 'currentColor' }) => (
  <div
    className="animate-spin"
    style={{
      width: `${size}px`,
      height: `${size}px`,
      border: `${Math.max(2, Math.round(size / 10))}px solid ${color}33`,
      borderTop: `${Math.max(2, Math.round(size / 10))}px solid ${color}`,
      borderRadius: '50%',
      display: 'inline-block',
    }}
  />
);

const SectionTitle = ({ title, icon: Icon }) => (
  <h3 className="text-xl font-bold text-zinc-800 dark:text-zinc-100 mb-4 flex items-center gap-2">
    <Icon size={20} className="text-blue-500 dark:text-blue-400" />
    {title}
  </h3>
);

const ControlGroup = ({ title, children }) => (
  <div className="mb-6 p-4 bg-zinc-50 dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-inner">
    <h4 className="text-sm font-semibold text-zinc-600 dark:text-zinc-400 mb-3">{title}</h4>
    <div className="space-y-3">
      {children}
    </div>
  </div>
);

const SegmentedControl = ({ value, options, onChange, segmentClass = 'flex-1' }) => (
  <div className="flex bg-zinc-200 dark:bg-zinc-700 p-1 rounded-lg space-x-1 overflow-x-auto whitespace-nowrap">
    {options.map(option => (
      <button
        key={option.value}
        onMouseDown={(e) => e.preventDefault()}
        onPointerDown={(e) => e.preventDefault()}
        tabIndex={-1}
        onClick={() => onChange(option.value)}
        className={`${segmentClass} flex-shrink-0 text-sm font-semibold py-1.5 px-3 rounded-md transition-all duration-200 ${
          value === option.value
            ? 'bg-white dark:bg-zinc-900 text-blue-600 dark:text-blue-400 shadow-sm'
            : 'text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white'
        }`}
      >
        {option.label}
      </button>
    ))}
  </div>
);

const SettingItem = ({ label, value }) => (
  <div className="flex justify-between items-center pb-2 border-b border-zinc-200 dark:border-zinc-700 last:border-b-0">
    <span className="text-sm text-zinc-600 dark:text-zinc-400 font-medium">{label}:</span>
    <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{value}</span>
  </div>
);

const TabButton = ({ value, label, icon: Icon, activeTab, setActiveTab }) => (
  <button 
    onClick={() => setActiveTab(value)} 
    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-semibold rounded-lg transition-colors duration-200 ${activeTab === value ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30 dark:shadow-blue-500/20' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'}`}
  >
    <Icon size={16} />
    <span>{label}</span>
  </button>
);

const Toast = ({ message, type, onClose }) => {
  const Icon = type === 'error' ? XCircle : Info;
  const color = type === 'error' ? 'red' : 'blue';
  
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, 5000);
    return () => clearTimeout(timer);
  }, [message, onClose]);

  return (
    <div className={`fixed bottom-4 left-1/2 -translate-x-1/2 p-4 max-w-sm w-full rounded-xl shadow-2xl z-50 transition-transform duration-300 bg-white dark:bg-zinc-800 border-l-4 border-${color}-500 flex items-start gap-3`}>
      <Icon size={20} className={`text-${color}-500 flex-shrink-0 mt-0.5`} />
      <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 flex-1">{message}</p>
      <button onClick={onClose} className="p-1 -mr-2 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
        <X size={16} />
      </button>
    </div>
  );
};


export default function App() {
  // REMOVE: const [useState, useEffect, useRef, useCallback] = [React.useState, React.useEffect, React.useRef, React.useCallback];

  const initialFormData = {
    duration: 30,
    topic: '',
    target: 'anak',
    imperative: 'topik',
    country: 'Indonesia (id-ID)',
    searchQuery: '',
    ttsVoice: 'wanita',
    voiceStyle: 'pencerita',
    aspectRatio: '9:16',
  };

  const [auth, setAuth] = useState(null);
  const [db, setDb] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [savedProjects, setSavedProjects] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [currentProjectId, setCurrentProjectId] = useState(null);
  const [formData, setFormData] = useState(initialFormData);
  const [generatedScript, setGeneratedScript] = useState('');
  const [generatedTopicIdea, setGeneratedTopicIdea] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copiedStates, setCopiedStates] = useState({});
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const [scriptVisuals, setScriptVisuals] = useState([]);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isUpdatingVisuals, setIsUpdatingVisuals] = useState(false);
  const [imageError, setImageError] = useState(null);
  const [thumbnailUrl, setThumbnailUrl] = useState(null);
  const [isGeneratingThumbnail, setIsGeneratingThumbnail] = useState(false);
  const [thumbnailError, setThumbnailError] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [audioError, setAudioError] = useState(null);
  const [youtubeMetadata, setYoutubeMetadata] = useState(null);
  const [isGeneratingMetadata, setIsGeneratingMetadata] = useState(false);
  const [metadataError, setMetadataError] = useState(null);
  const [showVideoPreview, setShowVideoPreview] = useState(false);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState(null);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [brainstormedIdeas, setBrainstormedIdeas] = useState([]);
  const [isBrainstorming, setIsBrainstorming] = useState(false);
  const [brainstormError, setBrainstormError] = useState(null);
  const [uploadSchedule, setUploadSchedule] = useState(null);
  const [isGeneratingSchedule, setIsGeneratingSchedule] = useState(false);
  const [scheduleError, setScheduleError] = useState(null);
  const [showConfirmationModal, setShowConfirmationModal] = useState(false);
  const [scriptVersionForVisuals, setScriptVersionForVisuals] = useState('');
  const [loadingStatus, setLoadingStatus] = useState({ progress: 0, message: '' });
  const [activeTab, setActiveTab] = useState('script');
  const [referenceImage, setReferenceImage] = useState(null);
  const [showPreviewConfirmation, setShowPreviewConfirmation] = useState(false);
  const [toast, setToast] = useState(null);


  const dropdownRef = useRef(null);
  const audioRef = useRef(null);
  const topicInputRef = useRef(null);
  const scriptTextareaRef = useRef(null);
  const referenceImageInputRef = useRef(null);
  const scrollRootRef = useRef(null);

  const countries = [
    'Indonesia (id-ID)', 'Amerika Serikat (en-US)', 'Inggris/Britania Raya (en-GB)',
    'Jepang (ja-JP)', 'Korea Selatan (ko-KR)', 'India (hi-IN)', 'Spanyol (es-ES)',
    'Prancis (fr-FR)', 'Jerman (de-DE)', 'Rusia (ru-RU)', 'Brasil (pt-BR)',
    'Arab Saudi (ar-SA)', 'Tiongkok/China (zh-CN)'
  ];

  const imperativeTypes = {
    topik: { label: 'Ide Topik' },
    sejarah: { label: 'Sejarah' },
    fakta: { label: 'Fakta Menarik' },
  };

  const targetAudiences = {
    anak: { label: 'Anak-anak' },
    dewasa: { label: 'Dewasa' }
  };

  const voiceStyles = {
    pencerita: { label: 'Pencerita (Tenang)' },
    antusias: { label: 'Presenter Antusias' },
    misteri: { label: 'Narator Misteri' },
    motivator: { label: 'Motivator Semangat' },
  };

  const isVisualsOutOfSync = generatedScript !== scriptVersionForVisuals;


  useEffect(() => {
    const root = scrollRootRef.current;
    const vv = window.visualViewport;
    if (!root || !vv) return;

    let rafId;
    let timeoutId;

    const onResize = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          if (typeof window.innerHeight !== 'number') return;
          const kb = Math.max(0, window.innerHeight - vv.height);
          const currentPadding = parseFloat(root.style.paddingBottom || '0');
          const newPadding = kb > 0 ? kb + 16 : 0;
          if (Math.abs(currentPadding - newPadding) > 1) {
            root.style.paddingBottom = newPadding > 0 ? `${newPadding}px` : '';
          }
          rafId = null; 
        });
      }, 150);
    };

    vv.addEventListener('resize', onResize);
    onResize();

    return () => {
      vv.removeEventListener('resize', onResize);
      clearTimeout(timeoutId);
      if (rafId) cancelAnimationFrame(rafId);
      if (root) {
        root.style.paddingBottom = '';
      }
    };
  }, []);

  const retrySignIn = async (authInstance, token, maxRetries = 5) => {
    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        if (token) {
          await signInWithCustomToken(authInstance, token);
        } else {
          await signInAnonymously(authInstance);
        }
        return;
      } catch (e) {
        attempt++;
        if (attempt >= maxRetries) {
          console.error("Sign-in Awal Gagal (Network/Transient):", e);
          throw e;
        }
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  };

  useEffect(() => {
    if (!firebaseConfig) {
      setError("Konfigurasi Firebase tidak tersedia. Coba muat ulang.");
      setIsAuthReady(true);
      return;
    }

    if (auth) return;

    const initFirebase = async () => {
      try {
        const app = initializeApp(firebaseConfig);
        const authInstance = getAuth(app);
        const dbInstance = getFirestore(app);
        setLogLevel('debug');

        setAuth(authInstance);
        setDb(dbInstance);

        const unsubscribe = onAuthStateChanged(authInstance, (user) => {
          if (user) {
            setUserId(user.uid);
          }
          setIsAuthReady(true);
        });

        const token = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

        try {
          await retrySignIn(authInstance, token);
        } catch (e) {
          console.error("Sign-in Final Gagal:", e);
        }

        return () => unsubscribe();

      } catch (e) {
        console.error("Error inisialisasi Firebase:", e);
        setError("Gagal menginisialisasi Firebase.");
        setIsAuthReady(true);
      }
    };

    initFirebase();
  }, []);

  useEffect(() => {
    if (db && userId && isAuthReady) {
      const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
      if (!userId) {
          console.error("Firestore Error: userId is null during onSnapshot setup, aborting query.");
          return;
      }
      
      const collectionPath = `artifacts/${appId}/users/${userId}/projects`;
      const q = query(collection(db, collectionPath));

      const unsubscribe = onSnapshot(q, (querySnapshot) => {
        const projects = [];
        querySnapshot.forEach((doc) => {
          projects.push({ id: doc.id, ...doc.data() });
        });
        setSavedProjects(projects.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0) ));
      }, (error) => {
        console.error("Gagal mengambil proyek dari Firestore:", error); 
      });
      return () => unsubscribe();
    }
  }, [db, userId, isAuthReady]);

  useEffect(() => {
    const jszipScript = document.createElement('script');
    jszipScript.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    jszipScript.async = true;
    document.body.appendChild(jszipScript);

    const filesaverScript = document.createElement('script');
    filesaverScript.src = "https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js";
    filesaverScript.async = true;
    document.body.appendChild(filesaverScript);

    return () => {
        if (jszipScript.parentNode) {
            document.body.removeChild(jszipScript);
        }
        if (filesaverScript.parentNode) {
            document.body.removeChild(filesaverScript);
        }
    }
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowCountryDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (audioUrl && audioRef.current) {
      audioRef.current.src = audioUrl;
    }
  }, [audioUrl]);

  const handleTopicChange = useCallback((newTopic) => {
    setFormData(prev => ({ ...prev, topic: newTopic }));
  }, []);

  const handleSearchQueryChange = useCallback((newQuery) => {
    setFormData(prev => ({ ...prev, searchQuery: newQuery }));
  }, []);

  const handleScriptChange = useCallback((newScript) => {
    setGeneratedScript(newScript);
  }, []);
  
  const handleCountrySelect = useCallback((country) => {
    setFormData(prev => ({ ...prev, country, searchQuery: '' }));
    setShowCountryDropdown(false);
  }, []);
  
  const handleReferenceImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 4 * 1024 * 1024) {
      setError("Ukuran file gambar referensi tidak boleh melebihi 4MB.");
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError("Format file tidak didukung. Harap gunakan JPG, PNG, atau WebP.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      const base64String = loadEvent.target.result;
      setReferenceImage({
        data: base64String.split(',')[1],
        mimeType: file.type,
        previewUrl: URL.createObjectURL(file)
      });
      setError(null);
      setToast({ 
        message: "Gambar referensi diunggah. INGAT: Hanya GAYA visual yang ditiru (bukan konten atau karakter) dan video output AKAN 9:16 (mungkin ada bilah hitam/letterbox).", 
        type: 'info' 
      });
    };
    reader.onerror = () => {
        setError("Gagal membaca file gambar.");
    };
    reader.readAsDataURL(file);
  };


  const generateSingleVisual = async (sceneDescription, sceneType, expressionHint, aspectRatio, consistentCharacterDescriptor = null, referenceImg = null) => {

    let imagePrompt;
    let apiUrl;
    let payload;

    const imageDimensions = "9:16";

    const consistencyInjection = (sceneType !== 'cta_like_subscribe' && consistentCharacterDescriptor) 
        ? `IMPORTANT: Ensure the main character's appearance (gender, race, age, clothes) is highly consistent with this previous description: "${consistentCharacterDescriptor}". ` 
        : '';


    if (referenceImg && referenceImg.data) {
        
        imagePrompt = `
          **TASK:** Generate a new image that visually depicts the [SCENE] description below.
          The image MUST be rendered **ONLY** in the artistic style (color palette, texture,
          lighting, and 3D rendering quality) of the provided reference image.

          **CRITICAL RULES:**
          1.  **NO CONTENT COPYING:** Do **NOT** copy the characters, faces, objects, background, or composition from the reference image. ONLY transfer the artistic style.
          2.  **FOLLOW THE SCENE:** The content of your generated image MUST be based **ENTIRELY** on the **[SCENE]** description below.
          3.  **NO TEXT:** ABSOLUTELY NO TEXT, NO WORDS, NO LETTERS, NO LOGOS.
          4.  **DIMENSION GUIDANCE:** Render the image to be easily contained within a 9:16 video frame.
          ${consistencyInjection}

          **[SCENE]:** ${sceneDescription}${expressionHint ? ` with a ${expressionHint} expression` : ''}.
        `.replace(/\s+/g, ' ').trim();
        
        apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent?key=${apiKey}`;
        
        payload = {
          contents: [{
            parts: [
              { text: imagePrompt },
              { inlineData: { mimeType: referenceImg.mimeType, data: referenceImg.data } }
            ]
          }],
          generationConfig: {
            responseModalities: ['IMAGE']
          },
        };

        const response = await fetchWithRetry(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!response.ok) {
           throw new Error(`Gagal membuat gambar referensi (Status: ${response.status}). Coba lagi.`);
        }
        const result = await response.json();
        const base64Data = result?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

        if (base64Data) {
            return { imageUrl: `data:image/png;base64,${base64Data}`, error: null, finalPrompt: imagePrompt, consistentCharacterDescriptor: null };
        } else {
            console.error("Image Gen Error (Ref): No data returned.", result);
            throw new Error(`AI tidak menghasilkan gambar dari referensi. Coba lagi.`);
        }

    } else {
        
        const styleWrapperPrompt = `
          A highly detailed 3D animated rendering, Pixar/Disney style.
          Vibrant colors, soft lighting, depth of field.
          The mood should be adventurous and curious, with bright daylight and soft shadows.
          Sharp focus on the main subjects, slight blur on the background.
          Viewer's eye level.
        `.replace(/\s+/g, ' ').trim();

        let expressionText = expressionHint && expressionHint !== 'neutral' ? ` with a ${expressionHint} expression` : '';
        
        if (sceneType === "cta_like_subscribe" || sceneDescription === "Call to action") {
          
          imagePrompt = `
            A stunning 3D soft design vertical social media Call-to-Action poster. The background uses smooth pastel blobs with soft gradient tones of pastel blue, pink, yellow, and mint green. The foreground features three clearly visible, vertically stacked, extruded 3D icons with rounded edges, representing: a **thumb-up icon**, a **share nodes icon**, and a **bell notification icon**. The thumb-up icon should have subtle sparkles. The bell icon must feature a small **red notification badge**. The lighting is soft and diffused with no hard shadows. The mood is friendly, cheerful, modern, and inviting. ABSOLUTELY NO TEXT, NO WORDS, NO LETTERS, NO LOGOS, NO GRAPHIC OVERLAYS.
          `.replace(/\s+/g, ' ').trim();
        } else {
          imagePrompt = `
            [SCENE]: ${sceneDescription}${expressionText}.
            ${consistencyInjection}
            ABSOLUTELY NO TEXT, NO WORDS, NO LETTERS, NO LOGOS.
            ${styleWrapperPrompt}
          `.replace(/\s+/g, ' ').trim();
        }

        
        apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`;
        payload = {
          instances: [{ prompt: imagePrompt }],
          parameters: {
            sampleCount: 1,
            aspectRatio: imageDimensions,
          }
        };

        const imageResponse = await fetchWithRetry(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const result = await imageResponse.json();

        if (!result.predictions || result.predictions.length === 0) {
          console.error("Image Generation Error: No candidates returned.", result);
          throw new Error(`AI tidak menghasilkan gambar. Coba ubah deskripsi atau coba lagi.`);
        }

        const prediction = result.predictions[0];
        const base64Data = prediction.bytesBase64Encoded;

        let descriptorToSave = null;
        if (sceneType === 'character_shot' && !consistentCharacterDescriptor) {
            descriptorToSave = imagePrompt.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim(); 
        }

        if (imageResponse.ok && base64Data) {
            return { imageUrl: `data:image/png;base64,${base64Data}`, error: null, finalPrompt: imagePrompt, consistentCharacterDescriptor: descriptorToSave };
        } else {
            console.error("Image Generation Error Response:", result);
            throw new Error(`Gagal memproses gambar dari AI. Respons tidak valid.`);
        }
    }
  };

  const handleRetryVisual = async (visual) => {
    setScriptVisuals(prev => prev.map(v => v.id === visual.id ? { ...v, isLoading: true, error: null } : v));

    let consistentCharacterDescriptor = visual.consistentCharacterDescriptor || null;
    if (visual.is_cta && !consistentCharacterDescriptor) {
        const firstCharacterScene = scriptVisuals.find(s => s.sceneType === 'character_shot' && !s.is_cta);
        consistentCharacterDescriptor = firstCharacterScene?.finalPrompt || null;
    }

    try {
      const sceneDesc = visual.is_cta ? "Call to action" : (visual.text || visual.finalPrompt);

      const result = await generateSingleVisual(
        sceneDesc,
        visual.sceneType,
        visual.expressionHint,
        formData.aspectRatio,
        consistentCharacterDescriptor,
        referenceImage
      );

      setScriptVisuals(prev => prev.map(v => v.id === visual.id ? {
        ...v,
        ...result,
        isLoading: false,
        error: null,
        consistentCharacterDescriptor: referenceImage ? null : (result.consistentCharacterDescriptor || consistentCharacterDescriptor) 
      } : v));

    } catch (e) {
      setScriptVisuals(prev => prev.map(v => v.id === visual.id ? { ...v, error: e.message, isLoading: false } : v));
      console.error("Gagal Generate Ulang Visual:", e);
    }
  };

  const handleRetryThumbnail = () => {
    if (!formData.topic) {
      setThumbnailError("Harap masukkan topik terlebih dahulu.");
      return;
    }
    generateThumbnailImage(formData.topic);
  };

  const handleBatchDownload = async () => {
    if (typeof window.JSZip === 'undefined' || typeof window.saveAs === 'undefined') {
      setToast({ message: "Library untuk mengunduh sedang dimuat. Silakan coba lagi sesaat lagi.", type: 'info' });
      return;
    }
    setIsDownloading(true);
    try {
      const zip = new window.JSZip();
      const imagePromises = scriptVisuals
        .filter(visual => visual.imageUrl)
        .map(async (visual, index) => {
          const response = await fetch(visual.imageUrl);
          const blob = await response.blob();
          zip.file(`visual_${index + 1}.png`, blob);
        });
      await Promise.all(imagePromises);
      
      zip.generateAsync({ type: "blob" }).then((content) => {
        window.saveAs(content, "9eleven_pro_visuals.zip");
      });
    } catch (err) {
      console.error("Gagal membuat file zip:", err);
      setError("Gagal mengemas file visual. Silakan coba lagi.");
    } finally {
      setIsDownloading(false);
    }
  };


  const generateThumbnailImage = async (topic) => {
    setIsGeneratingThumbnail(true);
    setThumbnailError(null);

    const thumbnailDimensions = "16:9";

    const thumbnailVisualPrompt = `
      A stunning, hyper-detailed YouTube thumbnail image for a viral video about "${topic}".
      The visual style must be highly cinematic and in 3D Pixar/Disney aesthetic.
      The image must be extremely relevant to the core subject of the topic.
      Use vibrant colors and dramatic lighting.
      MANDATORY: ABSOLUTELY NO TEXT, NO WORDS, NO LETTERS.
      MANDATORY: ABSOLUTELY NO LOGOS, NO GRAPHIC OVERLAYS.
      MANDATORY: ABSOLUTELY NO HUMAN FACES OR CHARACTERS.
      The image must be purely visual and symbolic of the topic.
    `.replace(/\s+/g, ' ').trim();

    try {
      
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`;
      const payload = {
        instances: [{ prompt: thumbnailVisualPrompt }],
        parameters: {
          sampleCount: 1,
          aspectRatio: thumbnailDimensions,
        }
      };
      const response = await fetchWithRetry(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json();

      if (result.predictions && result.predictions.length > 0 && result.predictions[0].bytesBase64Encoded) {
        setThumbnailUrl(`data:image/png;base64,${result.predictions[0].bytesBase64Encoded}`);
      } else {
        console.error("Thumbnail AI response:", result);
        throw new Error("AI tidak memberikan data gambar. Coba ganti topik.");
      }
    } catch (e) {
      setThumbnailError(e.message);
    } finally {
      setIsGeneratingThumbnail(false);
    }
  };

  const generateYoutubeMetadata = async (topic, script, countrySelection) => {
    setIsGeneratingMetadata(true);
    setMetadataError(null);
    const { languageNameForPrompt } = getLangInfo(countrySelection);

    const prompt = `You are a YouTube SEO expert. Create metadata for a YouTube Short.
1. Generate at least 5 engaging title options.
2. Write a short, optimized description.
3. Provide exactly 15 relevant hashtags (e.g., #funfacts).
4. Provide exactly 25 relevant tags/keywords (e.g., facts, history, unique).
All output MUST be in ${languageNameForPrompt} & in valid JSON format.
Topic: "${topic}"
Script: "${script}"`;

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            "titles": {
              type: "ARRAY",
              items: { "type": "STRING" }
            },
            "description": {
              type: "STRING"
            },
            "hashtags": {
              type: "ARRAY",
              items: { "type": "STRING" }
            },
            "tags": {
              type: "ARRAY",
              items: { "type": "STRING" }
            }
          }
        }
      }
    };

    try {
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
      const response = await fetchWithRetry(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error(`API Metadata Error: ${response.status}`);
      const result = await response.json();
      
      const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (jsonText) {
        const parsedJson = JSON.parse(jsonText);
        if (!parsedJson.titles || !Array.isArray(parsedJson.titles)) parsedJson.titles = [];
        if (!parsedJson.hashtags || !Array.isArray(parsedJson.hashtags)) parsedJson.hashtags = [];
        if (!parsedJson.tags || !Array.isArray(parsedJson.tags)) parsedJson.tags = [];
        setYoutubeMetadata(parsedJson);
      } else {
        throw new Error("Gagal mendapatkan metadata SEO dari AI.");
      }
    } catch (e) {
      setMetadataError(`Gagal memproses metadata: ${e.message}`);
    } finally {
      setIsGeneratingMetadata(false);
    }
  };

  const generateUploadSchedule = async (topic, countrySelection) => {
    setIsGeneratingSchedule(true);
    setScheduleError(null);
    const countryName = countrySelection.split(' (')[0];
    const { languageNameForPrompt } = getLangInfo(countrySelection);

    const today = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const formattedDate = today.toLocaleDateString('id-ID', options);

    const prompt = `You are a social media strategist. Today is ${formattedDate}.
Based on the target country "${countryName}" and video topic "${topic}", suggest the 3 BEST TIMES (local time) to upload to YouTube Shorts & TikTok TODAY.
Provide a brief (one sentence) justification for each time slot.
All output MUST be in ${languageNameForPrompt} and in valid JSON format.`;

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            schedule: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  time: { type: "STRING" },
                  reason: { type: "STRING" }
                },
                required: ["time", "reason"]
              }
            }
          },
          required: ["schedule"]
        }
      }
    };

    try {
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
      const response = await fetchWithRetry(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error(`API Schedule Error: ${response.status}`);
      const result = await response.json();
      
      const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;

      if (jsonText) {
        const parsedJson = JSON.parse(jsonText);
        setUploadSchedule(parsedJson);
      } else {
        throw new Error("Gagal mendapatkan saran jadwal dari AI.");
      }
    } catch (e) {
      setScheduleError(`Gagal memproses jadwal: ${e.message}`);
    } finally {
      setIsGeneratingSchedule(false);
    }
  };

  const handleBrainstormIdeas = async () => {
    if (!formData.topic) return;
    setIsBrainstorming(true);
    setBrainstormError(null);
    setBrainstormedIdeas([]);

    const { languageNameForPrompt } = getLangInfo(formData.country);

    const prompt = `You are a viral content strategist. Based on the broad category "${formData.topic}", generate 5 specific, clickable, and intriguing video topic ideas suitable for YouTube Shorts or TikTok. Each idea MUST be a punchy title, no longer than 7 words. The ideas must be in ${languageNameForPrompt}. Return ONLY a valid JSON array of strings.`;
    const payload = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", responseSchema: { type: "ARRAY", items: { "type": "STRING" } } } };

    try {
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
      const response = await fetchWithRetry(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error(`API Brainstorm Error: ${response.status}`);
      const result = await response.json();
      const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
      if (jsonText) {
        setBrainstormedIdeas(JSON.parse(jsonText));
      } else {
        throw new Error("Gagal mendapatkan ide dari AI.");
      }
    } catch (e) {
      setBrainstormError(e.message);
    } finally {
      setIsBrainstorming(false);
    }
  };

  const base64ToArrayBuffer = (base64) => {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  };

  const pcmToWav = (pcmData, sampleRate) => {
    const numChannels = 1, bytesPerSample = 2, blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign, dataSize = pcmData.byteLength;
    const buffer = new ArrayBuffer(44 + dataSize);
    const dataView = new DataView(buffer);
    const writeString = (v, o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    writeString(dataView, 0, 'RIFF');
    dataView.setUint32(4, 36 + dataSize, true);
    writeString(dataView, 8, 'WAVE');
    dataView.setUint32(12, 0x20746d66, true);
    dataView.setUint32(16, 16, true);
    dataView.setUint16(20, 1, true);
    dataView.setUint16(22, numChannels, true);
    dataView.setUint32(24, sampleRate, true);
    dataView.setUint32(28, byteRate, true);
    dataView.setUint16(32, blockAlign, true);
    dataView.setUint16(34, 16, true);
    writeString(dataView, 36, 'data');
    dataView.setUint32(40, dataSize, true);
    new Uint8Array(buffer, 44).set(new Uint8Array(pcmData));
    return new Blob([buffer], { type: 'audio/wav' });
  };

  const sanitizeScriptForTTS = (script) => {
    // FIX: Hapus hanya tag markup (**, [], ()) dan penomoran pengantar. 
    // Tanda baca atau nama yang panjang harus dipertahankan.
    let clean = script.replace(/\[.*?\]|\*\*.*?\*\*/g, ''); 
    clean = clean.replace(/\b(pertama|kedua|ketiga|keempat|kelima|keenam|ketujuh|selanjutnya|terakhir)[\.,:]?\s*/gi, '');
    clean = clean.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
    return clean;
  };

  const handleGenerateAudio = async () => {
    if (!generatedScript || isGeneratingAudio) return;
    setIsGeneratingAudio(true);
    setAudioError(null);
    try {
      const cleanScript = sanitizeScriptForTTS(generatedScript);
      const { langCode } = getLangInfo(formData.country);

      const stylePrompts = {
        pencerita: `Say calmly and clearly: ${cleanScript}`,
        antusias: `Say enthusiastically and cheerfully: ${cleanScript}`,
        misteri: `Say in a deep, slightly whispering, and mysterious voice: ${cleanScript}`,
        motivator: `Say with a powerful and inspiring tone: ${cleanScript}`,
      };

      let ttsPrompt = stylePrompts[formData.voiceStyle] || cleanScript;

      const voiceMap = { 'wanita': 'Aoede', 'pria': 'Algenib' };
      const selectedVoice = voiceMap[(formData.ttsVoice || '').toLowerCase()] || 'Aoede';

      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;
      const payload = {
        contents: [{ parts: [{ text: ttsPrompt }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: selectedVoice }
            }
          }
        },
        model: "gemini-2.5-flash-preview-tts"
      };

      if (langCode) {
        payload.generationConfig.speechConfig.languageCode = langCode;
      }

      const response = await fetchWithRetry(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error(`TTS API Error: ${response.status}`);
      const result = await response.json();
      const part = result.candidates?.[0]?.content?.parts?.[0];
      const audioData = part?.inlineData?.data;
      const mimeType = part?.inlineData?.mimeType;
      if (audioData && mimeType?.startsWith("audio/")) {
        const sampleRateMatch = mimeType.match(/rate=(\d+)/);
        const sampleRate = sampleRateMatch ? parseInt(sampleRateMatch[1], 10) : 24000;
        const pcmData = base64ToArrayBuffer(audioData);
        const wavBlob = pcmToWav(pcmData, sampleRate);

        const audioUrlForPlayer = URL.createObjectURL(wavBlob);
        setAudioUrl(audioUrlForPlayer);

        const audioForDuration = new Audio(audioUrlForPlayer);
        audioForDuration.onloadedmetadata = () => {
          const totalDuration = audioForDuration.duration;
          if (Number.isFinite(totalDuration) && totalDuration > 0) {
            setScriptVisuals(prevVisuals => {
              const { durations } = buildCuePointsFromSegments(prevVisuals, totalDuration);
              return prevVisuals.map((v, i) => ({
                ...v,
                duration: durations[i] || 0
              }));
            });
          }
        };

      } else {
        throw new Error('Tidak ada data audio yang dikembalikan.');
      }
    } catch (e) {
      setAudioError(e.message);
    } finally {
      setIsGeneratingAudio(false);
    }
  };


  const handleReset = (keepTopic = false) => {
    setCurrentProjectId(null);
    setFormData(prev => ({
      ...initialFormData,
      topic: keepTopic ? prev.topic : '',
      searchQuery: '',
      ttsVoice: prev.ttsVoice,
      voiceStyle: prev.voiceStyle,
      country: prev.country,
      aspectRatio: prev.aspectRatio,
      imperative: imperativeTypes[prev.imperative] ? prev.imperative : 'topik'
    }));
    setGeneratedScript('');
    setGeneratedTopicIdea('');
    setError(null);
    setCopiedStates({});
    setScriptVisuals([]);
    setImageError(null);
    setAudioUrl(null);
    setAudioError(null);
    setThumbnailUrl(null);
    setThumbnailError(null);
    setYoutubeMetadata(null);
    setMetadataError(null);
    setShowVideoPreview(false);
    setVideoPreviewUrl(null);
    setIsGeneratingPreview(false);
    setBrainstormedIdeas([]);
    setIsBrainstorming(false);
    setBrainstormError(null);
    setUploadSchedule(null);
    setScheduleError(null);
    setActiveTab('script');
    setLoadingStatus({ progress: 0, message: '' });
    setScriptVersionForVisuals(keepTopic ? generatedScript : '');
    
    if (referenceImage && referenceImage.previewUrl) {
       URL.revokeObjectURL(referenceImage.previewUrl);
    }
    setReferenceImage(null);
    if(referenceImageInputRef.current) {
        referenceImageInputRef.current.value = null;
    }
    setToast(null);
  };

  const executeSearch = async (query) => {
      const searchApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
      const { languageNameForPrompt } = getLangInfo(formData.country);

      const searchPayload = {
          contents: [{ parts: [{ text: `Temukan fakta penting, nama lengkap, dan detail historis singkat tentang topik ini: ${query}. Jawab dalam bahasa ${languageNameForPrompt} dan bahasa Inggris.` }] }],
          tools: [{ "google_search": {} }],
          systemInstruction: { parts: [{ text: `Anda adalah sejarawan. Jawab dengan ringkas dan faktual. JANGAN sertakan data grounding attributions atau citations dalam output.` }] },
      };

      try {
          const response = await fetchWithRetry(searchApiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(searchPayload)
          });

          if (!response.ok) throw new Error("Gagal mencari fakta historis.");

          const result = await response.json();
          const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
          return text || `(Fakta tidak ditemukan untuk: ${query})`;

      } catch (e) {
          console.error("Search API failed:", e);
          return `(Pencarian gagal: ${e.message})`;
      }
  };

  const buildPrompt = (factualInjection = '') => {
    const { languageNameForPrompt } = getLangInfo(formData.country);

    const durationWordCount = {
      15: '30-40', 20: '40-50', 30: '70-80',
    };
    const targetWordCount = durationWordCount[formData.duration];
    const audienceLabel = targetAudiences[formData.target].label;

    
    let roleInstruction = `You are a world-class COPYWRITER with 30 years of experience at a giant media company. Your core skill is crafting viral, highly engaging, and smooth-reading scripts for short-form video. Your content must be FACT-CHECKED, historically accurate, and must possess high substance ("daging" quality, no filler). You MUST avoid inflammatory or biased language. Focus on factual, dramatic, and emotionally compelling storytelling.`;
    let injectionDetail = '';


    
    const historyNarrativeStructure = `
- **Structure (MANDATORY):** Follow this viral structure precisely:
    1. HOOK (0-3s): Direct attention grab (question, extreme statement, or 'imagine if').
    2. NARASI TENGAH: Includes SETTING/TIME (3-6s), CONFLICT/CLIMAX (6-15s), IMPACT/CONSEQUENCE (15-20s). MUST contain the core historical data.
    3. KLIMAKS EMOSIONAL: Includes REFLECTION/MESSAGE (20-23s) and the **INTERACTION QUESTION/AJAKAN KOMENTAR**.
    4. PENUTUP DAN AJAKAN: Includes **ONLY** the final standard CTA phrase (Like, Share, Subscribe).
- **Historical Detail Focus:** You MUST explicitly mention the **full name** of the historical figure or the **specific name** of the location or event when introduced (e.g., "Sultan Hasanuddin" instead of just "sang Sultan"). This is NON-NEGOTIABLE.
- **Language/Tone:** Highly cinematic, dramatic, and haunting tone. Use descriptive, active language.
- **Total Length:** Target ${targetWordCount} words for a ~${formData.duration} second TTS.
`;

    const factNarrativeStructure = `
- **Structure (MANDATORY):** Follow the general viral arc (Hook, Inti, Ajakan, CTA):
    1. HOOK: A compelling 'imagine if' scenario or shocking statement to instantly hook the audience.
    2. NARASI TENGAH: The factual, detailed explanation of the amazing fact (the 'daging').
    3. KLIMAKS EMOSIONAL: The final thought/reflection and the **INTERACTION QUESTION/AJAKAN KOMENTAR** (e.g., "Berani nginep di sana?").
    4. PENUTUP DAN AJAKAN: Includes **ONLY** the final standard CTA phrase (Like, Share, Subscribe).
- **Language/Tone:** Highly engaging, punchy, and conversational (but still professional, unless target is 'anak'). Use short, impactful sentences.
- **Total Length:** Target ${targetWordCount} words for a ~${formData.duration} second TTS.
`;

    const adultNarrativeStructure = `- **Narrative Style:** MUST be serious, analytical, and professional, suitable for an intelligent adult audience. - **Tone:** Use objective, descriptive language. Focus on complex facts, philosophical implications, or deep analysis. - **Structure:** Use formal and well-formed, varied sentence structures. Maintain high vocabulary. - **Arc:** Present facts clearly (Hook -> Analysis -> Conclusion -> CTA).`;
    
    const childNarrativeStructure = `- **Narrative Style:** MUST be highly conversational, informal, and dramatic (like a captivating storyteller). - **Tone:** Use a direct-address style (speak to "you" or "kita"). Use rhetorical questions. - **Greeting (MANDATORY):** The script MUST start with a friendly, enthusiastic greeting to children, such as: "Halo teman-teman! Siap dengerin cerita seru?" or "Hai adik-adik semua, yuk kita mulai petualangan kita!". This greeting MUST be the absolute first line of the script. - **Structure:** Use very short, punchy sentences mixed with descriptive ones. - **Language:** Use modern, informal ${languageNameForPrompt} but remain intelligent and impactful. Use simple, cheerful language, and short sentences suitable for children. - **Arc:** Build an emotional arc: Greeting -> Hook -> Factual Story -> Emotional Climax -> Powerful Conclusion.`;
    
    const finalCtaPhrase = `Like, share dan subscribe yaa.`;


    
    let selectedStyle;
    const useChildStyle = (formData.target === 'anak');

    if (formData.imperative === 'sejarah') {
      roleInstruction = `You are a world-class HISTORIAN and viral COPYWRITER with 30 years of combined experience. Your content must be FACT-CHECKED and historically accurate.`;
      selectedStyle = historyNarrativeStructure;
      if (factualInjection) {
            injectionDetail = `
## MANDATORY FACT INJECTION
Anda SUDAH melakukan pencarian faktual tentang topik: ${formData.topic}. Hasil pencarian yang harus Anda gunakan di dalam naskah adalah:
---
${factualInjection}
---
Wajib menggunakan nama asli tokoh/tempat sesuai fakta di atas.
`;
      }
    } else if (formData.imperative === 'fakta') {
        selectedStyle = factNarrativeStructure;
    } else if (useChildStyle) {
      selectedStyle = childNarrativeStructure;
    } else {
      selectedStyle = adultNarrativeStructure;
    }
    
    const languageRule = `The ENTIRE narrative, including the Hook and any dramatic phrasing, MUST be written **EXCLUSIVELY** in ${languageNameForPrompt}.`;


    const imperativeLabel = imperativeTypes[formData.imperative] ? imperativeTypes[formData.imperative].label : 'Konten';

    if (formData.imperative === 'topik') {
      return `${roleInstruction}
## TASK: Create a Viral Topic Idea & Its Script
## PARAMETERS
- Content Category: ${formData.topic}
- Target Audience: ${audienceLabel}
- Language: ${languageNameForPrompt}
- Duration: ~${formData.duration} seconds
## RULES
1. Create ONE specific and viral video topic idea from the category.
2. Write a script for that idea with a duration of ~${formData.duration} seconds (around ${targetWordCount} words).
3. ${selectedStyle}
4. ${languageRule} 
5. The ENTIRE output MUST be in ${languageNameForPrompt}.
6. Use the format below precisely.
---
[TOPIC_IDEA]
[Topic idea result]
[/TOPIC_IDEA]
[SCRIPT_FOR_TOPIC]
[Script result, following the arc: Hook, Narasi, Klimaks, CTA]
[/SCRIPT_FOR_TOPIC]
---`;
    }

    // FINAL SCRIPT PROMPT STRUCTURE
    return `${roleInstruction}
${injectionDetail}
## TASK: Generate a Viral Video Script
## PARAMETERS
- Topic: ${formData.topic}
- Target Audience: ${audienceLabel}
- Type: ${imperativeLabel}
- Language: ${languageNameForPrompt}
- Duration: ~${formData.duration} seconds
## RULES
- Create a script following the required structure, suitable for ~${formData.duration} seconds (around ${targetWordCount} words).
- ${selectedStyle}
- ${languageRule} 
- The script MUST be in ${languageNameForPrompt}.
- ${useChildStyle ? 'The script MUST start with a friendly greeting to children.' : 'Go straight to the hook, no greetings.'}
- Output ONLY using the specified tags. DO NOT write anything outside the tags.
---
START_SCRIPT
[HOOK]
(Pembuka)
[/HOOK]
[NARASI_TENGAH]
(Konten Inti: Setting, Konflik, Dampak)
[/NARASI_TENGAH]
[KLIMAKS_EMOSIONAL]
(Refleksi, Pesan, dan WAJIB AJAKAN INTERAKSI di sini)
[/KLIMAKS_EMOSIONAL]
[PENUTUP_DAN_AJAKAN]
(${finalCtaPhrase})
[/PENUTUP_DAN_AJAKAN]
END_SCRIPT
---`;
  };

  const generateDynamicStoryboard = async (script, refImage) => {
    setIsGeneratingImage(true);
    setImageError(null);
    try {
      const sceneExtractionPrompt = `You are an expert video editor and prompt engineer for 3D Pixar/Disney style videos. Analyze the following script. Break it down into granular visual scenes. You MUST create **AT LEAST one visual for every 8 words of the script segment (prioritize short segments for better sync)**. If a sentence is long, you MUST split it into multiple visual scenes using short segments of the sentence (max 8 words). For each visual scene, provide a JSON object with FIVE keys:
1. "english_description": A FULL, detailed visual description in English for an AI image generator (describing the complete 3D Pixar-style scene, including characters, action, and background). **CRITICAL VISUAL DETAIL:** If the script mentions a specific historical figure (e.g., "Sultan Hasanuddin"), your description MUST accurately represent their historical appearance (clothing, setting, time period). If it mentions a specific location (e.g., "Candi Borobudur"), the image MUST clearly show that location.
2. "script_segment": The EXACT, **corresponding short segment (MAX 8 WORDS)** from the original script for that visual.
3. "scene_type": Classify the scene. Use "character_shot" for scenes focusing on a person or animal, "object_shot" for specific objects/scenes, or "general_shot". DO NOT use "cta_like_subscribe".
4. "expression_hint": Suggest a single-word expression (e.g., "surprised", "neutral", "happy").
5. "is_cta": A boolean (true/false). This MUST be \`false\` for all scenes. The CTA scene will be added later.

Return ONLY a valid JSON array of these objects. Make sure the JSON is well-formed.

Original Script:
"${script}"`;
      const textApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
      const textPayload = {
        contents: [{ parts: [{ text: sceneExtractionPrompt }] }],
        generationConfig: { responseMimeType: "application/json" }
      };
      
      const response = await fetchWithRetry(textApiUrl, { 
          method: 'POST', 
          headers: { 'Content-Type': 'application/json' }, 
          body: JSON.stringify(textPayload) 
      });
      
      if (!response.ok) throw new Error(`Gagal menganalisis naskah untuk visual (Status: ${response.status}).`);
      
      const result = await response.json();
      const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!jsonText) throw new Error("Tidak ada adegan visual yang dikembalikan dari AI.");

      let sceneData;
      try {
        sceneData = JSON.parse(jsonText);
      } catch (jsonError) {
        console.error("Gagal mem-parsing JSON dari AI:", jsonText);
        throw new Error(`AI mengembalikan format JSON yang tidak valid. Error: ${jsonError.message}`);
      }

      if (Array.isArray(sceneData) && sceneData.length > 0) {
        await generateVisualsFromDescriptions(sceneData, refImage);
      } else {
        throw new Error("Tidak ada adegan yang bisa diekstrak dari naskah.");
      }
    } catch (e) {
      setImageError(`Gagal membuat visual narasi: ${e.message}`);
      setIsGeneratingImage(false);
      throw e;
    }
  };

  const CTA_PROMPT_DESCRIPTION = "A highly detailed, 9:16 vertical social media Call-to-Action poster rendered in a 3D soft design style, inspired by playful modern graphics. The entire scene uses soft diffused lighting and no hard shadows. The background is composed of overlapping soft rounded shapes with gradient tones of pastel blue, pink, yellow, and mint green. The foreground features three clearly visible, vertically stacked, extruded 3D icons with rounded edges, representing: a **thumb-up icon**, a **share nodes icon**, and a **bell notification icon**. The thumb-up icon should have subtle sparkles. The bell icon must feature a small **red notification badge**. The mood is friendly, cheerful, modern, and inviting. ABSOLUTELY NO TEXT, NO WORDS, NO LETTERS, NO LOGOS, NO GRAPHIC OVERLAYS.";

  const generateVisualsFromDescriptions = async (sceneData, refImage) => {
    let filteredSceneData = sceneData.filter(s => !s.is_cta);

    const ctaScene = {
        english_description: CTA_PROMPT_DESCRIPTION,
        script_segment: 'Like, share dan subscribe yaa.', // FIX: Pastikan ini sesuai dengan final CTA phrase
        scene_type: 'cta_like_subscribe',
        expression_hint: 'excitement',
        is_cta: true,
    };
    
    filteredSceneData.push(ctaScene);
    
    sceneData = filteredSceneData;

    let consistentCharacterDescriptor = null;
    if (!refImage) {
        const firstCharacterScene = sceneData.find(s => s.sceneType === 'character_shot' && !s.is_cta);
        if (firstCharacterScene) {
            consistentCharacterDescriptor = firstCharacterScene.english_description;
        }
    }

    const initialVisuals = sceneData.map((scene, i) => ({
      id: i,
      text: scene.english_description,
      scriptSegment: scene.script_segment,
      sceneType: scene.scene_type,
      expressionHint: scene.expression_hint,
      is_cta: scene.is_cta || false,
      imageUrl: null,
      error: null,
      isLoading: true,
      consistentCharacterDescriptor: consistentCharacterDescriptor,
      finalPrompt: null,
    }));
    setScriptVisuals(initialVisuals);

    setIsGeneratingImage(true);
    setImageError(null);

    const imagePromises = sceneData.map(async (scene, i) => {
      setLoadingStatus(prev => ({ ...prev, message: `Membuat visual (${i + 1}/${sceneData.length})...` }));

      try {
        const descriptorForGeneration = (scene.sceneType !== 'character_shot' && !scene.is_cta && consistentCharacterDescriptor) 
            ? consistentCharacterDescriptor 
            : null;
        
        const sceneDesc = scene.english_description;
        
        const result = await generateSingleVisual(
          sceneDesc,
          scene.scene_type,
          scene.expressionHint,
          formData.aspectRatio,
          descriptorForGeneration, 
          refImage
        );

        let newDescriptor = result.consistentCharacterDescriptor;
        if (result.imageUrl && scene.sceneType === 'character_shot' && !consistentCharacterDescriptor) {
            consistentCharacterDescriptor = newDescriptor; 
        }


        setScriptVisuals(prev => prev.map(v => v.id === i ? {
          ...v,
          ...result,
          isLoading: false,
          error: null,
          consistentCharacterDescriptor: consistentCharacterDescriptor, 
        } : v));

        return { id: i, ...initialVisuals[i], ...result, isLoading: false };
      } catch (e) {
        setScriptVisuals(prev => prev.map(v => v.id === i ? { ...v, error: e.message, isLoading: false } : v));
        return { id: i, ...initialVisuals[i], error: e.message, isLoading: false };
      }
    });

    await Promise.all(imagePromises);
    setIsGeneratingImage(false);
  };

  const startContentGeneration = async () => {
    setShowConfirmationModal(false);

    if (!formData.topic) {
      setError("Harap masukkan topik atau kategori konten terlebih dahulu.");
      return;
    }

    handleReset(true);
    setIsLoading(true);
    setError(null);

    try {
      setLoadingStatus({ progress: 5, message: 'Menganalisis parameter...' });
      let scriptContentResult;
      let factualInjection = '';
      let finalTopic = formData.topic;

      if (formData.imperative === 'sejarah') {
          setLoadingStatus({ progress: 10, message: `Mencari fakta untuk: ${formData.topic}...` });
          factualInjection = await executeSearch(formData.topic);
          if (factualInjection.includes("(Pencarian gagal")) {
              throw new Error(`Pencarian fakta historis gagal. Coba lagi atau ubah topik. Detail: ${factualInjection}`);
          }
      }

      setLoadingStatus({ progress: 15, message: 'Membuat naskah...' });
      const scriptPrompt = buildPrompt(factualInjection);
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
      const payload = { contents: [{ parts: [{ text: scriptPrompt }] }] };
      const response = await fetchWithRetry(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });

      if (!response.ok) throw new Error(`Gagal membuat naskah (Status: ${response.status}). Coba lagi.`);

      const result = await response.json();

      if (result.promptFeedback?.blockReason) {
        let userFriendlyMessage = `Gagal membuat naskah karena permintaan diblokir oleh AI: ${result.promptFeedback.blockReason}. Coba ubah topik Anda.`;
        throw new Error(userFriendlyMessage);
      }
      const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      if (!rawText) throw new Error("Model AI tidak memberikan respons naskah. Coba lagi dengan topik lain.");

      if (formData.imperative === 'topik') {
        const topicMatch = rawText.match(/\[TOPIC_IDEA\]\s*([\s\S]*?)\s*\[\/TOPIC_IDEA\]/);
        const scriptMatch = rawText.match(/\[SCRIPT_FOR_TOPIC\]\s*([\s\S]*?)\s*\[\/SCRIPT_FOR_TOPIC\]/);
        const topicIdea = topicMatch ? topicMatch[1].trim() : null;
        scriptContentResult = scriptMatch ? scriptMatch[1].trim() : null;
        if (!topicIdea || !scriptContentResult) throw new Error("Gagal mem-parsing respons dari AI. Pastikan topik tidak terlalu sensitif.");
        setGeneratedTopicIdea(topicIdea);
        finalTopic = topicIdea;
      } else {
        const hookMatch = rawText.match(/\[HOOK\]\s*([\s\S]*?)\s*\[\/HOOK\]/);
        const narasiMatch = rawText.match(/\[NARASI_TENGAH\]\s*([\s\S]*?)\s*\[\/NARASI_TENGAH\]/);
        const klimaksMatch = rawText.match(/\[KLIMAKS_EMOSIONAL\]\s*([\s\S]*?)\s*\[\/KLIMAKS_EMOSIONAL\]/);
        const ctaMatch = rawText.match(/\[PENUTUP_DAN_AJAKAN\]\s*([\s\S]*?)\s*\[\/PENUTUP_DAN_AJAKAN\]/);

        const hook = hookMatch ? hookMatch[1].trim() : null;
        const narasi = narasiMatch ? narasiMatch[1].trim() : null;
        const klimaks = klimaksMatch ? klimaksMatch[1].trim() : null;
        const cta = ctaMatch ? ctaMatch[1].trim() : null;

        if (!hook || !narasi || !klimaks || !cta) {
          scriptContentResult = rawText.replace(/START_SCRIPT|END_SCRIPT|---|`|\[.*?\]/g, '\n').replace(/\n\s*\n/g, '\n').trim();
          if (!scriptContentResult) throw new Error("Gagal mengekstrak naskah dari AI. Respons tidak memiliki struktur yang diharapkan.");
        } else {
          scriptContentResult = [hook, narasi, klimaks, cta].join('\n\n');
        }
      }
      setGeneratedScript(scriptContentResult);

      setLoadingStatus({ progress: 25, message: 'Menentukan gaya visual...' });

      setLoadingStatus({ progress: 40, message: 'Memulai pembuatan aset visual...' });
      await generateDynamicStoryboard(scriptContentResult, referenceImage);
      setScriptVersionForVisuals(scriptContentResult);

      const assetGenerationPromises = [
        generateThumbnailImage(finalTopic).then(() => setLoadingStatus(prev => ({ ...prev, progress: Math.max(prev.progress, 70), message: 'Menghasilkan thumbnail...' }))),
        generateYoutubeMetadata(finalTopic, scriptContentResult, formData.country).then(() => setLoadingStatus(prev => ({ ...prev, progress: Math.max(prev.progress, 80), message: 'Menyusun optimasi SEO...' }))),
        generateUploadSchedule(finalTopic, formData.country).then(() => setLoadingStatus(prev => ({ ...prev, progress: Math.max(prev.progress, 90), message: 'Meracik jadwal upload...' }))),
      ];

      await Promise.all(assetGenerationPromises);

      setLoadingStatus({ progress: 100, message: 'Selesai!' });

    } catch (e) {
      console.error("Error lengkap di startContentGeneration:", e);
      setError(e.message);
      setLoadingStatus({ progress: 100, message: 'Gagal' });
    } finally {
      setTimeout(() => setIsLoading(false), 1000);
    }
  };

  const handleUpdateVisuals = async () => {
    if (!generatedScript || isUpdatingVisuals) return;

    setIsUpdatingVisuals(true);
    setImageError(null);
    try {
      setLoadingStatus({ progress: 20, message: 'Menganalisis naskah untuk adegan baru...' });
      
      setAudioUrl(null);
      setVideoPreviewUrl(null);
      setShowVideoPreview(false);

      await generateDynamicStoryboard(generatedScript, referenceImage);
      setScriptVersionForVisuals(generatedScript);
      setActiveTab('visuals');
      
    } catch (e) {
      setImageError(`Gagal memperbarui visual: ${e.message}`);
    } finally {
      setLoadingStatus({ progress: 100, message: 'Visual diperbarui.' });
      setTimeout(() => setIsUpdatingVisuals(false), 1000);
    }
  };

  const handleGenerateClick = () => {
    if (!formData.topic) {
      setError("Harap masukkan topik atau kategori konten terlebih dahulu.");
      return;
    }
    setError(null);
    setShowConfirmationModal(true);
  };
  
  const saveAsTxt = () => {
    if (!generatedScript) return;
    const blob = new Blob([generatedScript], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(formData.topic || 'naskah').replace(/[^a-z0-9]/gi, '_').toLowerCase()}_script.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleCopyToClipboard = (key, text) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand('copy');
      setCopiedStates(prev => ({ ...prev, [key]: true }));
      setTimeout(() => setCopiedStates(prev => ({ ...prev, [key]: false })), 2000);
    } catch (err) {
      console.error('Fallback: Gagal menyalin', err);
    }
    document.body.removeChild(textArea);
  };

  const proceedWithPreviewGeneration = async () => {
    setShowPreviewConfirmation(false);
    setIsGeneratingPreview(true);
    setVideoPreviewUrl(null);
    try {
      if (isVisualsOutOfSync) {
         throw new Error("Naskah telah diubah. Harap 'Perbarui Visual' terlebih dahulu.");
      }
      
      const visualsWithError = scriptVisuals.filter(v => v.error && !v.is_cta);
      if (visualsWithError.length > 0) {
          throw new Error(`Terdapat ${visualsWithError.length} visual yang error. Harap perbaiki sebelum melanjutkan.`);
      }

      const generatedVideoUrl = await handleGeneratePreviewSync({ 
          audioUrl, 
          scriptVisuals, 
          aspectRatio: formData.aspectRatio
      });
      setVideoPreviewUrl(generatedVideoUrl);
      setShowVideoPreview(true);
    } catch (e) {
      console.error("Gagal membuat pratinjau video tersinkronisasi:", e);
      setError(`Gagal merakit pratinjau video: ${e.message}. PASTIKAN audio telah digenerate.`);
    } finally {
      setIsGeneratingPreview(false);
    }
  };
  
  const handleSaveProject = async () => {
    if (!db || !userId || (!generatedScript && !formData.topic)) {
      setError("Tidak dapat menyimpan. Pastikan naskah sudah dibuat dan Anda terhubung.");
      return;
    }
    setIsSaving(true);
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

    const visualsToSave = scriptVisuals.map(visual => {
      const { imageUrl, duration, ...rest } = visual; 
      return { ...rest, imageUrl: null };
    });

    const projectData = {
      formData,
      generatedScript,
      generatedTopicIdea,
      scriptVisuals: visualsToSave,
      thumbnailUrl: null,
      youtubeMetadata,
      uploadSchedule,
      createdAt: serverTimestamp(),
    };

    try {
      const collectionPath = `artifacts/${appId}/users/${userId}/projects`;
      if (currentProjectId) {
         await setDoc(doc(db, collectionPath, currentProjectId), projectData, { merge: true });
      } else {
         const newDocRef = await addDoc(collection(db, collectionPath), projectData);
         setCurrentProjectId(newDocRef.id);
      }
      setToast({ message: "Proyek berhasil disimpan!", type: 'info' });
    } catch (e) {
      console.error("Gagal menyimpan proyek:", e);
      setError(`Gagal menyimpan proyek: ${e.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoadProject = async (project) => {
    handleReset();

    const loadedFormData = project.formData || initialFormData;
    if (!imperativeTypes[loadedFormData.imperative]) {
      loadedFormData.imperative = 'topik';
    }
    
    loadedFormData.aspectRatio = '9:16';

    setFormData(loadedFormData);
    setGeneratedScript(project.generatedScript || '');
    setGeneratedTopicIdea(project.generatedTopicIdea || '');
    setThumbnailUrl(project.thumbnailUrl || null);
    setYoutubeMetadata(project.youtubeMetadata || null);
    setUploadSchedule(project.uploadSchedule || null);
    setCurrentProjectId(project.id);
    setScriptVersionForVisuals(project.generatedScript || '');
    setActiveTab('script');

    const visualsToReload = project.scriptVisuals || [];
    let updatedVisuals = visualsToReload.map(v => ({
      id: v.id,
      text: v.text,
      scriptSegment: v.scriptSegment,
      sceneType: v.sceneType,
      expressionHint: v.expressionHint,
      is_cta: v.is_cta || false,
      error: "Gambar perlu dibuat ulang.",
      imageUrl: null,
      isLoading: false,
      consistentCharacterDescriptor: v.consistentCharacterDescriptor || null,
      finalPrompt: v.finalPrompt || null,
    }));
    setScriptVisuals(updatedVisuals);

    if (updatedVisuals.length > 0) {
      const ctaVisuals = updatedVisuals.filter(v => v.is_cta);
      setReferenceImage(null); 
      await Promise.all(ctaVisuals.map(visual => handleRetryVisual(visual)));
      if (loadedFormData.topic) {
         generateThumbnailImage(loadedFormData.topic, loadedFormData.aspectRatio);
      }
    }
  };

  const handleDeleteProject = async (projectId) => {
    if (!db || !userId || !projectId) return;
    if (window.confirm("Apakah Anda yakin ingin menghapus proyek ini? Tindakan ini tidak dapat diurungkan.")) {
      try {
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        await deleteDoc(doc(db, `artifacts/${appId}/users/${userId}/projects`, projectId));
        if (currentProjectId === projectId) {
          handleReset();
        }
        setToast({ message: "Proyek berhasil dihapus.", type: 'info' });
      } catch (error) {
        console.error("Gagal menghapus proyek:", error);
        setError("Gagal menghapus proyek.");
      }
    }
  };


  if (!isAuthReady) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-50 dark:bg-zinc-900">
        <MinimalSpinner size={32} color="#3b82f6" />
        <p className="ml-3 text-zinc-600 dark:text-zinc-400">Menghubungkan ke layanan...</p>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap');
        body, .font-sans { font-family: 'Poppins', sans-serif; }
        .bg-app-bg { background-color: #f7f7f7; }
        .dark .bg-app-bg { background-color: #0d0d0f; }
        .card { transition: all 0.3s ease; border-radius: 16px; }
        .dark .card { background-color: #1c1c1e; }
        .shadow-ui { box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06); }
        .dark .shadow-ui { box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.2), 0 4px 6px -2px rgba(0, 0, 0, 0.1); }
        .script-textarea { resize: none; }
        
        input:focus, textarea:focus {
          -webkit-user-select: text;
          user-select: text;
        }
        button {
          -webkit-tap-highlight-color: transparent;
          touch-action: manipulation;
        }
        .app-scroll-root {
          overflow-y: auto;
        }
        .modal-content-lg {
            max-width: 95%;
            width: 700px;
        }
        @media (max-width: 640px) {
            .modal-content-lg {
                max-width: 95%;
                width: 100%;
            }
        }
      `}</style>
      
      <div style={{ display: 'none' }}>
        <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
        <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
      </div>
      

      <div ref={scrollRootRef} className="app-scroll-root min-h-[100svh] bg-app-bg dark:bg-zinc-900 p-4 sm:p-8 lg:p-12 text-zinc-900 dark:text-zinc-100 transition-colors duration-300 font-sans" data-no-anchor>
        <div className="max-w-7xl mx-auto">

          <header className="text-center py-6 sm:py-8 px-4">
            <h1 className="text-5xl sm:text-7xl font-extrabold tracking-tight mb-2 text-blue-600 dark:text-blue-400">9ELEVEN PRO</h1>
            <span className="inline-block bg-black text-yellow-400 text-base font-bold px-4 py-1.5 rounded-full uppercase tracking-widest mb-2 shadow-lg shadow-black/50">EKSKLUSIF CREATOR</span>
          </header>

          <main className="grid lg:grid-cols-5 gap-8">

            <div className="lg:col-span-2 flex flex-col gap-6 lg:sticky lg:top-8 lg:h-fit">
              <div className="bg-white dark:bg-zinc-800 card rounded-3xl shadow-2xl shadow-zinc-300/50 dark:shadow-black/50 p-6 sm:p-8">

                <SectionTitle title="Pengaturan Konten" icon={Settings} />

                <ControlGroup title={formData.imperative === 'topik' ? 'Kategori Konten' : 'Topik Spesifik'}>
                  <MemoizedTopicInput
                    inputRef={topicInputRef}
                    topic={formData.topic}
                    onTopicChange={handleTopicChange}
                    placeholder={formData.imperative === 'topik' ? "Cth: Sejarah Kerajaan Majapahit" : "Cth: Manfaat minum air putih"}
                  />
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={handleBrainstormIdeas}
                    disabled={!formData.topic || isBrainstorming}
                    className="w-full flex items-center justify-center gap-2 text-sm bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-medium py-2 px-4 rounded-xl transition-colors disabled:opacity-50"
                  >
                    {isBrainstorming ? <MinimalSpinner size={16} color="#3b82f6"/> : <Lightbulb size={16} />}
                    {isBrainstorming ? 'Mencari Ide...' : 'Brainstorm Ide Topik'}
                  </button>
                  {brainstormedIdeas.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {brainstormedIdeas.map((idea, index) => (
                        <button
                          key={index}
                          onMouseDown={(e) => e.preventDefault()}
                          onPointerDown={(e) => e.preventDefault()}
                          onClick={() => { handleTopicChange(idea); setBrainstormedIdeas([]); }}
                          className="w-full text-left text-xs p-2 bg-blue-100/50 dark:bg-blue-900/30 rounded-lg hover:bg-blue-200/70 dark:hover:bg-blue-900/50 transition truncate"
                        >{idea}</button>
                      ))}
                    </div>
                  )}
                  {brainstormError && <p className="text-xs text-red-500 mt-2">{brainstormError}</p>}
                  
                  <input
                    type="file"
                    ref={referenceImageInputRef}
                    onChange={handleReferenceImageUpload}
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                  />
                  {referenceImage ? (
                    <div className="mt-3">
                      <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">Gambar Referensi Gaya:</p>
                      <div className="relative group w-full aspect-video rounded-lg overflow-hidden border border-zinc-300 dark:border-zinc-700">
                        <img src={referenceImage.previewUrl} alt="Referensi" className="w-full h-full object-contain" />
                        <button
                          onClick={() => {
                            handleReset(true);
                          }}
                          className="absolute top-2 right-2 p-1.5 bg-black/60 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X size={16} />
                        </button>
                      </div>
                      <p className="text-xs text-yellow-600 dark:text-yellow-500 mt-2">Gaya Pixar diganti. Hanya gaya yang ditiru, bukan konten. Output akhir 9:16.</p>
                    </div>
                  ) : (
                    <button
                      onClick={() => referenceImageInputRef.current?.click()}
                      className="w-full mt-3 flex items-center justify-center gap-2 text-sm bg-zinc-100 dark:bg-zinc-700/50 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 font-medium py-2 px-4 rounded-xl transition-colors"
                    >
                      <ImageIcon size={16} /> Unggah Gambar Referensi (Opsional)
                    </button>
                  )}
                  
                </ControlGroup>

                <ControlGroup title="Tipe & Target">
                  <div className="grid grid-cols-1 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">Tipe Konten</label>
                      <SegmentedControl
                        value={formData.imperative}
                        options={Object.entries(imperativeTypes).map(([key, value]) => ({ value: key, label: value.label }))}
                        onChange={(value) => setFormData({ ...formData, imperative: value })}
                        segmentClass="min-w-[100px]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">Target Audiens</label>
                      <SegmentedControl
                        value={formData.target}
                        options={Object.entries(targetAudiences).map(([key, value]) => ({ value: key, label: value.label }))}
                        onChange={(value) => setFormData({ ...formData, target: value })}
                      />
                    </div>
                  </div>
                </ControlGroup>

                <ControlGroup title="Format Video">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">Durasi (Detik)</label>
                      <SegmentedControl
                        value={formData.duration}
                        options={[{ value: 15, label: '15s' }, { value: 20, label: '20s' }, { value: 30, label: '30s' }]}
                        onChange={(value) => setFormData({ ...formData, duration: value })}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                        Rasio Aspek
                      </label>
                      <div className="w-full px-4 py-2.5 bg-zinc-100 dark:bg-zinc-700/50 border border-zinc-300 dark:border-zinc-700 rounded-lg transition text-sm">
                        <span className="font-semibold text-zinc-800 dark:text-zinc-200">9:16 (Wajib)</span>
                      </div>
                      {referenceImage && (
                        <p className="text-xs text-yellow-600 dark:text-yellow-500 mt-1.5">Pratinjau akan menggunakan letterboxing jika visual tidak 9:16.</p>
                      )}
                    </div>
                  </div>
                </ControlGroup>

                <ControlGroup title="Suara, Bahasa & Negara">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">Gaya Suara</label>
                      <select
                        value={formData.voiceStyle}
                        onChange={(e) => setFormData({ ...formData, voiceStyle: e.target.value })}
                        className="w-full px-4 py-2 bg-zinc-100 dark:bg-zinc-700/50 border border-zinc-300 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none transition text-sm">
                        {Object.entries(voiceStyles).map(([key, value]) => (<option key={key} value={key}>{value.label}</option>))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">TTS Gender</label>
                      <select
                        value={formData.ttsVoice}
                        onChange={(e) => setFormData({ ...formData, ttsVoice: e.target.value })}
                        className="w-full px-4 py-2 bg-zinc-100 dark:bg-zinc-700/50 border border-zinc-300 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none transition text-sm">
                        <option value="wanita">Wanita Dewasa</option>
                        <option value="pria">Pria Dewasa</option>
                      </select>
                    </div>
                    <div ref={dropdownRef} className="relative col-span-2">
                      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">Negara & Bahasa Output</label>
                      <button
                        onMouseDown={(e) => e.preventDefault()}
                        onPointerDown={(e) => e.preventDefault()}
                        onClick={() => setShowCountryDropdown(prev => !prev)}
                        className="w-full px-4 py-2 bg-zinc-100 dark:bg-zinc-700/50 border border-zinc-300 dark:border-zinc-700 rounded-lg cursor-pointer flex items-center justify-between text-left transition text-sm">
                        <span className="truncate">{formData.country}</span><Search size={16} className="text-zinc-400 flex-shrink-0 ml-2" />
                      </button>
                      {showCountryDropdown && (<div className="absolute z-20 w-full mt-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-2xl max-h-60 overflow-y-auto">
                        <div className="p-2 border-b border-zinc-200 dark:border-zinc-700 sticky top-0 bg-white dark:bg-zinc-800">
                          <MemoizedSearchInput
                            query={formData.searchQuery}
                            onQueryChange={handleSearchQueryChange}
                            placeholder="Cari negara..."
                          />
                        </div>
                        <ul>
                            {countries.filter(c => c.toLowerCase().includes(formData.searchQuery.toLowerCase())).map((country) => (
                            <li 
                              key={country} 
                              onClick={() => handleCountrySelect(country)} 
                              className="px-4 py-2 hover:bg-blue-500 hover:text-white cursor-pointer text-sm"
                            >
                              {country}
                            </li>
                            ))}
                        </ul>
                      </div>)}
                    </div>
                  </div>
                </ControlGroup>

                <div className="grid grid-cols-2 gap-3 mt-6 pt-4 border-t border-zinc-100 dark:border-zinc-700/50">
                  <button
                    onClick={handleGenerateClick}
                    disabled={isLoading || !formData.topic}
                    className="col-span-2 flex items-center justify-center gap-2 bg-blue-600 text-white font-bold py-4 px-4 rounded-xl hover:bg-blue-700 transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-xl shadow-blue-500/30"
                  >
                    {isLoading ? <MinimalSpinner size={20} color="white"/> : <Sparkles size={20}/>}
                    {isLoading ? loadingStatus.message : 'Generate Konten'}
                  </button>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={handleSaveProject}
                    disabled={isSaving || !generatedScript}
                    className="flex items-center justify-center gap-2 bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 font-semibold py-3 px-4 rounded-xl hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors disabled:opacity-50"
                  >
                    {isSaving ? <MinimalSpinner size={20} color="#64748b"/> : <Save size={20}/>} Simpan
                  </button>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => handleReset(false)}
                    title="Reset Form"
                    className="flex items-center justify-center gap-2 bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 font-semibold py-3 px-4 rounded-xl hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors"
                  >
                    <RotateCcw size={20}/> Reset
                  </button>
                </div>
                
                {error && (
                    <div className="mt-4 p-3 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-lg text-red-700 dark:text-red-300 text-sm flex items-center gap-2">
                        <AlertCircle size={18} />
                        <span className="flex-1">{error}</span>
                        <button onClick={() => setError(null)} className="ml-auto text-red-500 dark:text-red-300 hover:opacity-70"><X size={18}/></button>
                    </div>
                )}
              </div>

              {savedProjects.length > 0 && (
                <div className="bg-white dark:bg-zinc-800 card rounded-3xl shadow-lg shadow-zinc-300/50 dark:shadow-black/50 p-6">
                  <SectionTitle title="Proyek Tersimpan" icon={Archive} />
                  <div className="space-y-3 max-h-64 overflow-y-auto pr-2">
                    {savedProjects.map(p => (
                      <div key={p.id} className="flex items-center justify-between bg-zinc-100 dark:bg-zinc-700/50 p-3 rounded-xl hover:bg-blue-50 dark:hover:bg-zinc-700 transition-colors border border-zinc-200 dark:border-zinc-700">
                        <button
                          onMouseDown={(e) => e.preventDefault()}
                          onPointerDown={(e) => e.preventDefault()}
                          onClick={() => handleLoadProject(p)}
                          className="flex-1 text-left min-w-0"
                        >
                          <p className="font-semibold text-sm truncate text-blue-700 dark:text-blue-300">{p.formData?.topic || "Tanpa Judul"}</p>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">{p.createdAt?.seconds ? new Date(p.createdAt.seconds * 1000).toLocaleDateString('id-ID') : '?'}</p>
                        </button>
                        <button
                          onMouseDown={(e) => e.preventDefault()}
                          onPointerDown={(e) => e.preventDefault()}
                          onClick={() => handleDeleteProject(p.id)}
                          title="Hapus Proyek"
                          className="ml-4 p-2 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/50 rounded-full transition-colors flex-shrink-0"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="lg:col-span-3 flex flex-col gap-6">
              <div className="bg-white dark:bg-zinc-800 card rounded-3xl shadow-2xl shadow-zinc-300/50 dark:shadow-black/50 p-6 sm:p-8 min-h-[500px]">
                {isLoading ? (
                  <div className="flex flex-col items-center justify-center h-full min-h-[400px]">
                    <div className="relative mb-6">
                      <MinimalSpinner size={80} color="#3b82f6"/>
                    </div>
                    <div className="w-full max-w-sm bg-zinc-200 dark:bg-zinc-700 rounded-full h-2 mb-4">
                      <div className="bg-blue-600 h-2 rounded-full transition-all duration-700" style={{ width: `${loadingStatus.progress}%` }}></div>
                    </div>
                    <p className="text-zinc-600 dark:text-zinc-400 text-sm font-semibold">{loadingStatus.message}</p>
                  </div>
                ) : error && !generatedScript ? (
                  <div className="flex flex-col items-center justify-center h-full text-center text-red-600 bg-red-50 dark:bg-red-900/20 p-8 rounded-2xl min-h-[400px]">
                    <AlertCircle size={40} className="text-red-500"/><p className="mt-3 font-bold text-lg">Gagal Memproses</p><p className="text-sm">{error}</p>
                  </div>
                ) : generatedScript || activeTab === 'script' ? (
                  <div>
                    <div className="bg-zinc-200 dark:bg-zinc-900/50 p-1 rounded-xl flex gap-1 mb-6">
                      <TabButton value="script" label="Naskah & Audio" icon={PenSquare} activeTab={activeTab} setActiveTab={setActiveTab} />
                      <TabButton value="visuals" label="Visual & Aset" icon={LayoutGrid} activeTab={activeTab} setActiveTab={setActiveTab} />
                      <TabButton value="seo" label="Optimasi & Jadwal" icon={TrendingUp} activeTab={activeTab} setActiveTab={setActiveTab} />
                    </div>

                    {activeTab === 'script' && (
                      <div>
                        <SectionTitle title="Naskah & Suara" icon={Mic} />
                        {generatedTopicIdea && <div className="mb-6 bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-400 p-4 rounded-r-lg">
                           <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-1">Ide Topik yang Dihasilkan:</p>
                           <p className="text-sm text-zinc-800 dark:text-zinc-100">{generatedTopicIdea}</p>
                        </div>}

                        <MemoizedScriptTextarea
                          textareaRef={scriptTextareaRef}
                          script={generatedScript}
                          onScriptChange={handleScriptChange}
                          placeholder="Tulis atau edit naskah di sini..."
                        />

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                          <button
                            onMouseDown={(e) => e.preventDefault()}
                            onPointerDown={(e) => e.preventDefault()}
                            onClick={() => handleCopyToClipboard('script', generatedScript)}
                            className="flex items-center justify-center gap-2 text-sm bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-600 dark:text-zinc-200 font-medium py-2.5 px-3 rounded-xl transition-colors col-span-2 md:col-span-1"
                          >
                            {copiedStates['script'] ? <Check size={16} className="text-blue-500"/> : <Copy size={16} />} {copiedStates['script'] ? 'Tersalin' : 'Salin'}
                          </button>
                          <button
                            onMouseDown={(e) => e.preventDefault()}
                            onPointerDown={(e) => e.preventDefault()}
                            onClick={saveAsTxt}
                            className="flex items-center justify-center gap-2 text-sm bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-600 dark:text-zinc-200 font-medium py-2.5 px-3 rounded-xl transition-colors col-span-2 md:col-span-1"
                          >
                            <Download size={16} /> Unduh
                          </button>

                          <button
                            onMouseDown={(e) => e.preventDefault()}
                            onPointerDown={(e) => e.preventDefault()}
                            onClick={handleUpdateVisuals}
                            disabled={isUpdatingVisuals || isGeneratingImage || !generatedScript}
                            className={`flex items-center justify-center gap-2 text-sm bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 font-medium py-2.5 px-3 rounded-xl transition-colors disabled:opacity-50 col-span-2 ${isVisualsOutOfSync ? 'ring-2 ring-purple-500 ring-offset-2 ring-offset-white dark:ring-offset-zinc-800' : ''}`}
                          >
                            {isUpdatingVisuals ? <MinimalSpinner size={16} color="#9333ea"/> : <ImageIcon size={16} />}
                            {isUpdatingVisuals ? 'Memperbarui...' : 'Perbarui Visual'}
                          </button>
                        </div>

                        <button
                          onMouseDown={(e) => e.preventDefault()}
                          onPointerDown={(e) => e.preventDefault()}
                          onClick={handleGenerateAudio}
                          disabled={isGeneratingAudio || !generatedScript}
                          className="w-full flex items-center justify-center gap-2 text-sm bg-blue-600 text-white font-bold py-3 px-4 rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 shadow-lg shadow-blue-500/30"
                        >
                          {isGeneratingAudio ? <MinimalSpinner size={16} color="white"/> : <Mic size={16} />}
                          {isGeneratingAudio ? 'Generate Audio...' : 'Generate Audio'}
                        </button>
                        {audioError && <p className="text-xs text-red-500 mt-2 text-center">{audioError}</p>}

                        {audioUrl && (
                          <div className="mt-4">
                            <audio ref={audioRef} controls className="w-full h-10 mb-4 rounded-full" />
                            <button
                              onMouseDown={(e) => e.preventDefault()}
                              onPointerDown={(e) => e.preventDefault()}
                              onClick={proceedWithPreviewGeneration}
                              disabled={isGeneratingPreview || !audioUrl || scriptVisuals.length === 0 || scriptVisuals.some(v => v.isLoading) || isVisualsOutOfSync}
                              title={isVisualsOutOfSync ? "Naskah telah diubah. Harap 'Perbarui Visual' terlebih dahulu." : "Buat Pratinjau Video"}
                              className="w-full flex items-center justify-center gap-3 bg-purple-600 text-white font-bold py-3 px-4 rounded-xl hover:bg-purple-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-purple-500/30"
                            >
                              {isGeneratingPreview ? <MinimalSpinner size={20} color="white"/> : <PlayCircle />}
                              {isGeneratingPreview ? 'Merakit Pratinjau...' : 'Pratinjau Sinkronisasi Video'}
                            </button>
                            {isVisualsOutOfSync && <p className="text-xs text-center text-yellow-600 dark:text-yellow-400 mt-2 font-semibold">⚠️ Naskah & Visual TIDAK SINKRON. Tekan 'Perbarui Visual' sebelum membuat Pratinjau.</p>}
                          </div>
                        )}
                      </div>
                    )}

                    {activeTab === 'visuals' && (
                      <div>
                        <SectionTitle title="Aset Visual" icon={LayoutGrid} />

                        <ControlGroup title="Thumbnail Video (16:9)">
                          <div className="aspect-[9/16] max-w-xs mx-auto bg-zinc-200 dark:bg-zinc-700 rounded-xl flex items-center justify-center overflow-hidden relative border border-zinc-300 dark:border-zinc-600">
                            {isGeneratingThumbnail ? (<div className="flex flex-col items-center text-zinc-400"><MinimalSpinner size={24} color="#64748b"/> <span className="text-xs mt-2">Membuat...</span></div>
                            ) : thumbnailError ? (<div className="text-red-500 flex flex-col items-center text-center p-2"><XCircle size={24} /><span className="text-xs mt-1">{thumbnailError}</span></div>
                            ) : thumbnailUrl ? ( <> <img src={thumbnailUrl} alt="Thumbnail" className="w-full h-full object-cover"/> <a href={thumbnailUrl} download="thumbnail_9x16.png" title="Unduh Thumbnail" className="absolute bottom-3 right-3 p-2 bg-black/50 text-white rounded-full hover:bg-black/75 transition-colors"><Download size={16} /></a></>
                            ) : <p className="text-sm text-zinc-400 p-4 text-center">Belum ada thumbnail. Generate konten utama terlebih dahulu.</p>}
                          </div>
                          <div className='mt-3'>
                            <button
                              onMouseDown={(e) => e.preventDefault()}
                              onPointerDown={(e) => e.preventDefault()}
                              onClick={handleRetryThumbnail}
                              disabled={isGeneratingThumbnail || !formData.topic}
                              className="w-full flex items-center justify-center gap-2 text-sm bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 font-semibold py-2.5 px-4 rounded-xl hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors disabled:opacity-50"
                            >
                              {isGeneratingThumbnail ? <MinimalSpinner size={16} color="#64748b"/> : <RotateCcw size={16}/>} Generate Ulang Thumbnail
                            </button>
                          </div>
                        </ControlGroup>

                        <div className="mb-4">
                          <button
                            onMouseDown={(e) => e.preventDefault()}
                            onPointerDown={(e) => e.preventDefault()}
                            onClick={handleBatchDownload}
                            disabled={isDownloading || scriptVisuals.some(v => !v.imageUrl)}
                            className="w-full flex items-center justify-center gap-2 text-sm bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 font-semibold py-3 px-4 rounded-xl transition disabled:opacity-50 hover:bg-purple-200 dark:hover:bg-purple-900/50"
                          >
                            {isDownloading ? <MinimalSpinner size={16} color="#9333ea"/> : <Archive size={16} />}
                            {isDownloading ? 'Mengemas Semua Visual...' : 'Unduh Semua Visual (.zip)'}
                          </button>
                          {imageError && <p className="text-xs text-red-500 mt-2 text-center">{imageError}</p>}
                        </div>

                        <h4 className="font-semibold text-zinc-700 dark:text-zinc-300 mb-3 flex items-center gap-2"><Clapperboard size={18}/> Storyboard ({scriptVisuals.length} Adegan)</h4>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                          {scriptVisuals.map((visual, index) => (
                            <div key={visual?.id || index} className="bg-zinc-100 dark:bg-zinc-700/50 rounded-xl p-3 border border-zinc-200 dark:border-zinc-700 shadow-md shadow-zinc-200/50 dark:shadow-black/20">
                              <div className={`w-full aspect-[9/16] bg-zinc-200 dark:bg-zinc-800 rounded-lg mb-2 flex items-center justify-center overflow-hidden relative`}>
                                
                                {visual.isLoading ? ( 
                                  <div className="flex flex-col items-center text-zinc-400"><MinimalSpinner size={24} color="#64748b"/> <span className="text-xs mt-2">Membuat Visual...</span></div>
                                ) : visual.imageUrl ? ( 
                                  <img src={visual.imageUrl} alt={visual.text} className="w-full h-full object-cover"/> 
                                ) : visual.error ? ( 
                                  <div className="text-red-500 flex flex-col items-center text-center p-2">
                                    <XCircle size={24} />
                                    <span className="text-xs mt-1 truncate w-full font-medium" title={visual.error}>{visual.error || "Gagal membuat gambar."}</span>
                                  </div>
                                ) : (
                                  <div className="w-full h-full bg-black/90 flex flex-col items-center justify-center text-white text-xs p-2 text-center">Layar Jeda<br/>(Call to Action)</div>
                                )}
                                
                                {visual.imageUrl && (
                                  <a href={visual.imageUrl} download={`visual_${index + 1}.png`} className="absolute bottom-2 right-2 p-1.5 bg-black/50 text-white rounded-full hover:bg-black/75 transition-colors"><Download size={14} /></a>
                                )}
                                
                                {(visual.is_cta || visual.error || visual.imageUrl) && !visual.isLoading && (
                                <button
                                  onMouseDown={(e) => e.preventDefault()}
                                  onPointerDown={(e) => e.preventDefault()}
                                  onClick={() => handleRetryVisual(visual)}
                                  className="absolute top-2 right-2 p-1.5 bg-black/50 text-white rounded-full hover:bg-black/75 transition-colors"
                                  title="Generate Ulang Visual"
                                >
                                  <RotateCcw size={14} />
                                </button>
                                )}
                                
                              </div>
                              <p className={`font-bold text-sm ${visual.is_cta ? 'text-purple-600 dark:text-purple-400' : 'text-zinc-800 dark:text-zinc-200'}`}>Adegan #{index + 1} {visual.is_cta && '(CTA)'}</p>
                              <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">{visual?.scriptSegment || '...'}</p>
                              {visual.duration && !visual.is_cta && (
                                <p className="font-semibold text-xs text-blue-500 dark:text-blue-400 mt-1">
                                  {visual.duration.toFixed(1)}s
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {activeTab === 'seo' && (
                      <div>
                        <SectionTitle title="Optimasi & Distribusi" icon={TrendingUp} />

                        {(isGeneratingMetadata || isGeneratingSchedule) ? (
                          <div className="flex items-center justify-center p-12">
                            <MinimalSpinner size={32} color="#3b82f6" />
                          </div>
                        ) : metadataError || scheduleError ? (
                          <>
                            {metadataError && <div className="text-red-600 bg-red-50 dark:bg-red-900/20 p-4 rounded-xl text-sm mb-4"><AlertCircle size={16} className="inline mr-2"/> Gagal membuat metadata: {metadataError}</div>}
                            {scheduleError && <div className="text-red-600 bg-red-50 dark:bg-red-900/20 p-4 rounded-xl text-sm"><AlertCircle size={16} className="inline mr-2"/> Gagal membuat jadwal: {scheduleError}</div>}
                          </>
                        ) : (youtubeMetadata || uploadSchedule) ? (
                          <div className="space-y-6">
                            {youtubeMetadata?.titles?.length > 0 && (
                              <ControlGroup title="1. Pilihan Judul yang Menarik">
                                <ul className="space-y-2">{youtubeMetadata.titles.map((title, index) => (<li key={index} className="flex items-center justify-between bg-zinc-100 dark:bg-zinc-700 p-3 rounded-lg border border-zinc-200 dark:border-zinc-700"><span className="text-sm text-zinc-800 dark:text-zinc-200 font-medium">{title}</span><button onMouseDown={(e) => e.preventDefault()} onPointerDown={(e) => e.preventDefault()} onClick={() => handleCopyToClipboard(`title-${index}`, title)} title="Salin judul" className="text-zinc-500 hover:text-blue-500 p-1">{copiedStates[`title-${index}`] ? <Check size={16} className="text-blue-500"/> : <Copy size={16}/>}</button></li>))}</ul>
                              </ControlGroup>
                            )}

                            {youtubeMetadata?.description && (
                              <ControlGroup title="2. Deskripsi Teroptimasi">
                                <div className="flex items-center justify-end mb-2"><button onMouseDown={(e) => e.preventDefault()} onPointerDown={(e) => e.preventDefault()} onClick={() => handleCopyToClipboard('desc', youtubeMetadata.description)} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-blue-500 font-semibold">{copiedStates['desc'] ? <Check size={14} className="text-blue-500"/> : <Copy size={14}/>} {copiedStates['desc'] ? 'Tersalin' : 'Salin Semua'}</button></div>
                                <p className="text-sm bg-zinc-100 dark:bg-zinc-700/50 p-3 rounded-lg whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{youtubeMetadata.description}</p>
                              </ControlGroup>
                            )}

                            {(youtubeMetadata?.hashtags?.length > 0 || youtubeMetadata?.tags?.length > 0) && (
                              <ControlGroup title="3. Hashtags & Keywords">
                                {youtubeMetadata.hashtags?.length > 0 && (
                                  <div className="mb-4">
                                    <div className="flex items-center justify-between mb-2"><h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Hashtags ({youtubeMetadata.hashtags.length})</h4><button onMouseDown={(e) => e.preventDefault()} onPointerDown={(e) => e.preventDefault()} onClick={() => handleCopyToClipboard('hashtags', (youtubeMetadata.hashtags).map(t=>t.startsWith('#')?t:`#${t}`).join(' '))} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-blue-500">{copiedStates['hashtags'] ? <Check size={14} className="text-blue-500"/> : <Copy size={14}/>} {copiedStates['hashtags'] ? 'Tersalin' : 'Salin'}</button></div>
                                    <div className="flex flex-wrap gap-2">{youtubeMetadata.hashtags.map((tag, index) => <span key={index} className="text-xs bg-blue-500/20 text-blue-800 dark:text-blue-300 px-2 py-0.5 rounded-full font-medium">{tag.startsWith('#') ? tag : `#${tag}`}</span>)}</div>
                                  </div>
                                )}
                                {youtubeMetadata.tags?.length > 0 && (
                                  <div >
                                    <div className="flex items-center justify-between mb-2"><h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Tags/Keywords ({youtubeMetadata.tags.length})</h4><button onMouseDown={(e) => e.preventDefault()} onPointerDown={(e) => e.preventDefault()} onClick={() => handleCopyToClipboard('tags', (youtubeMetadata.tags).join(', '))} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-blue-500">{copiedStates['tags'] ? <Check size={14} className="text-blue-500"/> : <Copy size={14}/>} {copiedStates['tags'] ? 'Tersalin' : 'Salin'}</button></div>
                                    <div className="flex flex-wrap gap-2">{youtubeMetadata.tags.map((tag, index) => <span key={index} className="text-xs bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 px-2 py-0.5 rounded-full font-medium">{tag}</span>)}</div>
                                  </div>
                                )}
                              </ControlGroup>
                            )}

                            {uploadSchedule?.schedule?.length > 0 && (
                              <ControlGroup title="4. Saran Waktu Upload (Waktu Lokal)">
                                <div className="space-y-3">
                                  {uploadSchedule.schedule.map((item, index) => (
                                    <div key={index} className="p-3 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-200 dark:border-blue-700">
                                      <div className="flex justify-between items-center">
                                        <p className="text-sm font-medium text-blue-700 dark:text-blue-300">Waktu Saran {index + 1}:</p>
                                        <p className="text-lg font-bold text-zinc-900 dark:text-white">{item.time}</p>
                                      </div>
                                      <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">{item.reason}</p>
                                    </div>
                                  ))}
                                </div>
                              </ControlGroup>
                            )}
                          </div>
                        ) : (
                          <p className="text-sm text-center text-zinc-500 dark:text-zinc-400 py-4">Metadata dan jadwal akan muncul di sini setelah konten utama digenerate.</p>
                        )}
                      </div>
                    )}

                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center text-zinc-500 dark:text-zinc-400 min-h-[500px]">
                    <Sparkles size={40} className="mb-4 text-blue-400" />
                    <h3 className="font-bold text-xl text-zinc-700 dark:text-zinc-200">Siap Membuat Konten Viral?</h3>
                    <p className="text-sm max-w-xs mx-auto mt-2">Isi semua pengaturan di panel kiri, lalu tekan tombol "Generate Konten" untuk melihat hasilnya di sini.</p>
                  </div>
                )}
              </div>
            </div>
          </main>
        </div>

        {showConfirmationModal && (
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 transition-opacity duration-300"
            onClick={(e) => { if (e.target === e.currentTarget) { setShowConfirmationModal(false); } }}
          >
            <div className="bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl w-full max-w-md p-6 relative card border-2 border-blue-500 dark:border-blue-400">
              <h3 className="text-2xl font-bold text-blue-600 dark:text-blue-400 mb-4 flex items-center gap-2">
                <AlertCircle size={24}/> Konfirmasi Pengaturan
              </h3>
              <p className="text-sm text-zinc-700 dark:text-zinc-300 mb-6">
                Mohon tinjau pengaturan berikut sebelum memulai proses generasi.
              </p>

              <div className="space-y-3 p-4 bg-zinc-50 dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 max-h-80 overflow-y-auto">
                <SettingItem label="Topik/Kategori" value={formData.topic || 'Belum diisi'} />
                <SettingItem label="Gaya Visual" value={referenceImage ? 'Mengikuti Gambar Referensi (Hanya Gaya)' : '3D Pixar/Disney Style'} />
                <SettingItem label="Tipe Konten" value={imperativeTypes[formData.imperative]?.label || 'Ide Topik'} />
                <SettingItem label="Target Audiens" value={targetAudiences[formData.target]?.label || 'Anak-anak'} />
                <SettingItem label="Durasi Video" value={`${formData.duration} Detik`} />
                <SettingItem label="Rasio Aspek" value={formData.aspectRatio} />
                <SettingItem label="Bahasa Output" value={formData.country} />
                <SettingItem label="Gaya Suara" value={voiceStyles[formData.voiceStyle]?.label || 'Pencerita (Tenang)'} />
                <SettingItem label="TTS Gender" value={formData.ttsVoice === 'wanita' ? 'Wanita Dewasa' : 'Pria Dewasa'} />
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => setShowConfirmationModal(false)}
                  className="flex-1 flex items-center justify-center gap-2 bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 font-semibold py-3 px-4 rounded-xl hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors"
                >
                  <X size={20}/> Batal
                </button>
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={startContentGeneration}
                  disabled={isLoading}
                  className="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white font-bold py-3 px-4 rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-60 shadow-lg shadow-blue-500/30"
                >
                  <Sparkles size={20}/> Yakin & Lanjutkan
                </button>
              </div>
            </div>
          </div>
        )}

        {showPreviewConfirmation && (
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 transition-opacity duration-300"
            onClick={(e) => { if (e.target === e.currentTarget) { setShowPreviewConfirmation(false); } }}
          >
            <div className="bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl w-full max-w-md p-6 relative card border-2 border-yellow-500 dark:border-yellow-400">
              <h3 className="text-2xl font-bold text-yellow-600 dark:text-yellow-400 mb-4 flex items-center gap-2">
                <AlertCircle size={24}/> Periksa Visual
              </h3>
              <p className="text-sm text-zinc-700 dark:text-zinc-300 mb-6">
                Sebelum melanjutkan, pastikan semua visual (terutama adegan narasi) telah berhasil dibuat dan tidak ada yang error di tab 'Visual & Aset'.
              </p>
              
              <div className="flex gap-3 mt-6">
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => setShowPreviewConfirmation(false)}
                  className="flex-1 flex items-center justify-center gap-2 bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 font-semibold py-3 px-4 rounded-xl hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors"
                >
                  <X size={20}/> Batal
                </button>
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={proceedWithPreviewGeneration}
                  className="flex-1 flex items-center justify-center gap-2 bg-purple-600 text-white font-bold py-3 px-4 rounded-xl hover:bg-purple-700 transition-colors shadow-lg shadow-purple-500/30"
                >
                  <PlayCircle size={20}/> Ayo Lanjutkan
                </button>
              </div>
            </div>
          </div>
        )}

        {showVideoPreview && (
          <div
            className="fixed inset-0 bg-black/90 backdrop-blur-md z-50 flex items-center justify-center p-4 transition-opacity duration-300"
            onClick={(e) => { if (e.target === e.currentTarget) { setShowVideoPreview(false); } }}
          >
            <div className="bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl p-6 relative card modal-content-lg">
              <h3 className="text-2xl font-bold text-zinc-800 dark:text-zinc-100 mb-4 flex items-center gap-2"><PlayCircle size={24}/> Pratinjau Video</h3>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => setShowVideoPreview(false)}
                className="absolute top-4 right-4 p-2 bg-zinc-100 dark:bg-zinc-700 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-600 rounded-full transition-colors"><X size={20} /></button>
              {videoPreviewUrl ? (
                <>
                  <div className={`mx-auto mb-4 ${formData.aspectRatio === '1:1' ? 'max-w-xs aspect-square' : 'max-w-sm aspect-[9/16]'} rounded-xl bg-black shadow-inner`}>
                    <video src={videoPreviewUrl} controls autoPlay className={`w-full h-full object-contain rounded-xl`}></video>
                  </div>
                  
                  <a
                    onMouseDown={(e) => e.preventDefault()}
                    onPointerDown={(e) => e.preventDefault()}
                    href={videoPreviewUrl}
                    download="9eleven_pro_preview.webm"
                    className="w-full flex items-center justify-center gap-2 bg-purple-600 text-white font-bold py-3 px-4 rounded-xl hover:bg-purple-700 transition-all shadow-lg shadow-purple-500/30">
                    <Download size={18} /> Unduh Pratinjau (.webm)
                  </a>
                </>
              ) : ( <div className={`w-full ${formData.aspectRatio === '1:1' ? 'aspect-square' : 'aspect-[9/16]'} rounded-xl bg-black flex items-center justify-center`}><p className="text-white">Gagal membuat video.</p></div> )}
            </div>
          </div>
        )}
        
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </div>
    </>
  );
}
