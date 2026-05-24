import React, { useEffect, useState, useRef } from 'react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, BarChart, Bar, LineChart, Line, ComposedChart
} from 'recharts';
import { Thermometer, Droplets, Wind, Filter, Cloud } from 'lucide-react';
import api, { getLatestPrediction } from '../services/api';
import mqtt from 'mqtt';

const Dashboard = () => {
    const [latest, setLatest] = useState(null);
    const [history, setHistory] = useState([]);
    const [predictions, setPredictions] = useState(null);
    const [loading, setLoading] = useState(true);
    const [mqttConnected, setMqttConnected] = useState(false);
    const [daily, setDaily] = useState([]);
    const [hourly, setHourly] = useState([]);
    const [hourlyPerDay, setHourlyPerDay] = useState({});
    const [showFilter, setShowFilter] = useState(false);
    const [selectedCategory, setSelectedCategory] = useState('aqi');
    const [selectedDay, setSelectedDay] = useState(() => {
        // Default ke hari ini untuk menampilkan 24 jam terakhir
        const today = new Date();
        return today.toISOString().split('T')[0]; // Format YYYY-MM-DD
    });
    const [clickedBar, setClickedBar] = useState(null); // Untuk animasi klik bar
    const [isBarInteracting, setIsBarInteracting] = useState(false); // Untuk animasi container
    
    // ✅ REF UNTUK PREVENT DOUBLE FETCH
    const hasFetchedRef = useRef(false);

    // ✅ KATEGORI FILTER YANG TERSEDIA
    const filterCategories = [
        {
            key: 'aqi',
            label: 'AQI (Kualitas Udara)',
            icon: Wind,
            color: '#2ECC71',
            unit: '',
            dataKey: 'aqi'
        },
        {
            key: 'co',
            label: 'Karbon Monoksida (CO)',
            icon: Wind,
            color: '#E74C3C',
            unit: 'PPM',
            dataKey: 'mq7_ppm'
        },
        {
            key: 'co2',
            label: 'Karbon Dioksida (CO₂)',
            icon: Cloud,
            color: '#F39C12',
            unit: 'PPM',
            dataKey: 'mq135_ppm'
        },
        {
            key: 'suhu',
            label: 'Suhu',
            icon: Thermometer,
            color: '#F1C40F',
            unit: '°C',
            dataKey: 'suhu'
        },
        {
            key: 'kelembapan',
            label: 'Kelembapan',
            icon: Droplets,
            color: '#3498DB',
            unit: '%',
            dataKey: 'kelembapan'
        }
    ];

    // ✅ HITUNG AQI DARI DATA CO (MQ7)
    const getAQIFromCO = (co_ppm) => {
        let BP_lo, BP_hi, I_lo, I_hi;

        if (co_ppm <= 3.49) {
            BP_lo = 0;    BP_hi = 3.49;  I_lo = 0;   I_hi = 50;
        } else if (co_ppm <= 6.99) {
            BP_lo = 3.50; BP_hi = 6.99;  I_lo = 51;  I_hi = 100;
        } else if (co_ppm <= 13.09) {
            BP_lo = 7.00; BP_hi = 13.09; I_lo = 101; I_hi = 200;
        } else if (co_ppm <= 26.19) {
            BP_lo = 13.10; BP_hi = 26.19; I_lo = 201; I_hi = 300;
        } else {
            return 400;
        }

        const aqi = ((I_hi - I_lo) / (BP_hi - BP_lo)) * (co_ppm - BP_lo) + I_lo;
        return Math.round(aqi);
    };

    // ✅ KATEGORI AQI
    const getAQICategory = (aqi) => {
        if (aqi <= 50) return "Baik";
        if (aqi <= 100) return "Sedang";
        if (aqi <= 200) return "Tidak Sehat";
        if (aqi <= 300) return "Sangat Tidak Sehat";
        return "Berbahaya";
    };

    // ✅ CUSTOM TOOLTIP - FILTER TREND DATA FROM DISPLAY
    const CustomTooltip = ({ active, payload, label }) => {
        if (active && payload && payload.length) {
            const filteredPayload = payload.filter(entry => !entry.dataKey.startsWith('trend_'));
            if (filteredPayload.length === 0) return null;
            
            return (
                <div className="bg-white p-2 rounded shadow-lg border border-slate-200">
                    <p className="text-sm font-medium text-slate-700">{label}</p>
                    {filteredPayload.map((entry, index) => (
                        <p key={index} style={{ color: entry.color }} className="text-sm">
                            {entry.name}: {typeof entry.value === 'number' ? entry.value.toFixed(1) : entry.value}
                        </p>
                    ))}
                </div>
            );
        }
        return null;
    };

    // ✅ MOCK DATA UNTUK TESTING
    const getMockHistoryData = () => {
        const now = new Date();
        return Array.from({ length: 12 }, (_, i) => {
            const date = new Date(now.getTime() - (i * 10 * 60000)); // 10 min intervals
            const mq7 = 5 + Math.random() * 8;
            return {
                id: i,
                mq7_ppm: parseFloat(mq7.toFixed(2)),
                mq135_ppm: 100 + Math.random() * 50,
                suhu: 26 + Math.random() * 4,
                kelembapan: 60 + Math.random() * 25,
                created_at: date.toISOString(),
                aqi: getAQIFromCO(mq7),
                time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                day: date.toLocaleDateString([], { weekday: 'short' })
            };
        }).reverse();
    };

    const fetchInitialData = async () => {
        try {
            const today = new Date().toISOString().split('T')[0];
            const [dailyRes, hourlyRes, latestRes, todayHourlyRes, predictionRes] = await Promise.all([
                api.get('/daily'),
                api.get('/hourly'),
                api.get('/latest'),
                api.get(`/hourly?date=${today}`),
                getLatestPrediction()
            ]);

            // ✅ DAILY (7 hari)
            const dailyData = dailyRes.data.map(d => ({
                ...d,
                aqi: getAQIFromCO(d.mq7_ppm)
            }));
            setDaily(dailyData);

            // ✅ HOURLY (chart utama - 2 hari terakhir)
            const hourlyData = hourlyRes.data.map(d => ({
                ...d,
                aqi: getAQIFromCO(d.mq7_ppm)
            }));
            setHistory(hourlyData);

            // ✅ HOURLY UNTUK HARI INI
            const todayHourlyData = todayHourlyRes.data.map(d => ({
                ...d,
                aqi: getAQIFromCO(d.mq7_ppm)
            }));
            setHourlyPerDay(prev => ({
                ...prev,
                [today]: todayHourlyData
            }));

            // ✅ LATEST (card)
            setLatest({
                suhu: latestRes.data.temperature,
                kelembapan: latestRes.data.humidity,
                mq7_ppm: latestRes.data.gasMQ7,
                mq135_ppm: latestRes.data.gasMQ135,
                updated_at: latestRes.data.waktu,
                aqi: getAQIFromCO(latestRes.data.gasMQ7)
            });

            // ✅ 24-hour prediction data
            const predictionData = Array.isArray(predictionRes) ? predictionRes : [];

            if (predictionData.length > 0) {
                const formattedPredictionData = predictionData.map(d => ({
                    ...d,
                    time: new Date(d.waktu).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
                    timeLabel: new Date(d.waktu).toLocaleTimeString('id-ID', { hour: '2-digit' }),
                    suhu: d.temperature,
                    kelembapan: d.humidity,
                    mq7_ppm: d.gasMQ7,
                    mq135_ppm: d.gasMQ135,
                    aqi: getAQIFromCO(d.gasMQ7)
                }));
                setPredictions(formattedPredictionData);
            } else {
                setPredictions([]);
            }
            
            // ✅ Semua data berhasil di-fetch - loading akan di-set false oleh useEffect yang memantau state

        } catch (err) {
            setHistory(getMockHistoryData());
            setPredictions([]);
        }
    };

    // ✅ FETCH HOURLY DATA UNTUK HARI TERTENTU
    const fetchHourlyForDay = async (date) => {
        if (!date) return [];
        try {
            const response = await api.get(`/hourly?date=${date}`);
            const hourlyData = response.data.map(d => ({
                ...d,
                aqi: getAQIFromCO(d.mq7_ppm)
            }));
            setHourlyPerDay(prev => ({
                ...prev,
                [date]: hourlyData
            }));
            return hourlyData;
        } catch (err) {
            setHourlyPerDay(prev => ({
                ...prev,
                [date]: []
            }));
            return [];
        }
    };

    const refreshPredictionData = async () => {
        try {
            const predictionRes = await getLatestPrediction();
            const predictionArray = Array.isArray(predictionRes) ? predictionRes : [];

            if (predictionArray.length > 0) {
                const formattedPredictionData = predictionArray.map(d => ({
                    ...d,
                    time: new Date(d.waktu).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
                    timeLabel: new Date(d.waktu).toLocaleTimeString('id-ID', { hour: '2-digit' }),
                    suhu: d.temperature,
                    kelembapan: d.humidity,
                    mq7_ppm: d.gasMQ7,
                    mq135_ppm: d.gasMQ135,
                    aqi: getAQIFromCO(d.gasMQ7)
                }));
                setPredictions(formattedPredictionData);
            } else {
                setPredictions([]);
            }
        } catch (err) {
            // ignore prediction refresh errors silently for now
        }
    };

    useEffect(() => {
        const interval = setInterval(() => {
            refreshPredictionData();
        }, 5 * 60 * 1000);

        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        // ✅ PREVENT DOUBLE FETCH - hanya fetch 1x meskipun StrictMode
        if (hasFetchedRef.current) {
            return;
        }
        hasFetchedRef.current = true;

        // Set default latest data
        setLatest({
            suhu: 26.5,
            kelembapan: 65,
            mq7_ppm: 5.2,
            mq135_ppm: 120,
            aqi: getAQIFromCO(5.2),
            updated_at: new Date().toISOString()
        });

        // Fetch history even before MQTT connects
        fetchInitialData();

        // Set loading to false after 10 seconds max if data tidak selesai di-fetch
        const loadingTimeout = setTimeout(() => {
            setLoading(false);
        }, 10000);

        // Close filter dropdown when clicking outside
        const handleClickOutside = (event) => {
            if (!event.target.closest('.filter-dropdown')) {
                setShowFilter(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);

        // MQTT Connection
        const client = mqtt.connect("wss://broker.hivemq.com:8884/mqtt", {
            keepalive: 60,
            reconnectPeriod: 5000,
            connectTimeout: 30000,
            clean: true
        });

        client.on("connect", () => {
            setMqttConnected(true);
            client.subscribe("iot/airquality/9f3xA2kLm/sensor/udara", (err) => {
                if (err) {
                    // ignore subscribe error silently
                }
            });
        });

       client.on("message", (topic, message) => {
        try {
            const data = JSON.parse(message.toString());

            const mq7 = data.mq7_ppm || data.mq7 || data.co || 5;
            const mq135 = data.mq135_ppm || data.mq135 || data.co2 || 100;
            const suhu = data.suhu || data.temperature || 25;
            const kelembapan = data.kelembapan || data.humidity || 60;

            const now = new Date();

            const newData = {
                mq7_ppm: mq7,
                mq135_ppm: mq135,
                suhu: suhu,
                kelembapan: kelembapan,
                waktu: now.toISOString(),
                aqi: getAQIFromCO(mq7),
                time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                day: now.toLocaleDateString([], { weekday: 'short' })
            };

            // ✅ update latest (card)
            setLatest({
                ...newData,
                updated_at: newData.waktu
            });

            // ✅ Jangan update history 24 jam secara realtime dari MQTT
            //    Ini menjaga grafik historis tetap stabil dan hanya menampilkan
            //    data snapshot dari API, sehingga tidak bergeser setiap ada paket baru.
            //    Jika diperlukan real-time view terpisah, bisa ditambahkan nanti.

            // MQTT message received - tidak perlu set loading false di sini lagi
            // karena loading sudah di-set false di fetchInitialData
        } catch (error) {
            // ignore parse errors from MQTT payload
        }
    });

        client.on("error", () => {
            setMqttConnected(false);
        });

        client.on("offline", () => {
            setMqttConnected(false);
        });

        client.on("reconnect", () => {
            // reconnecting silently
        });

        client.on("close", () => {
            setMqttConnected(false);
        });

        

        return () => {
            clearTimeout(loadingTimeout);
            document.removeEventListener('mousedown', handleClickOutside);
          
            if (client.connected) {
                client.end();
            }
        };
    }, []);

    // ✅ USEEFFECT UNTUK MEMASTIKAN LOADING HANYA BERHENTI SAAT SEMUA DATA READY
    useEffect(() => {
        // Cek apakah semua data sudah tersedia
        const hasDailyData = daily.length > 0;
        const hasHourlyData = history.length > 0;
        const hasLatestData = latest !== null;
        const hasPredictionsData = predictions !== null; // predictions bisa kosong tapi harus sudah di-set

        // Jika semua data sudah tersedia dan loading masih true, set loading false
        if (hasDailyData && hasHourlyData && hasLatestData && hasPredictionsData && loading) {
            setLoading(false);
        }
    }, [daily, history, latest, predictions, loading]);

    // ✅ DETECT KLIK DI LUAR CHART UNTUK RESET PILIHAN HARI
    useEffect(() => {
        const handleClickOutside = (event) => {
            // Jika ada bar yang diklik (hari dipilih) dan klik terjadi di luar chart area
            if (clickedBar && !event.target.closest('.bar-chart-container')) {
                // Reset pilihan hari ke hari ini
                setClickedBar(null);
                setIsBarInteracting(false);
                setSelectedDay(new Date().toISOString().split('T')[0]);
            }
        };

        // Tambahkan event listener
        document.addEventListener('mousedown', handleClickOutside);

        // Cleanup
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [clickedBar]);

    useEffect(() => {
        if (!selectedDay) return;
        const today = new Date().toISOString().split('T')[0];
        const cachedHourly = hourlyPerDay[selectedDay];
        if (cachedHourly && cachedHourly.length > 0) return;

        fetchHourlyForDay(selectedDay);
    }, [selectedDay, hourlyPerDay]);

    if (loading) return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50">
            <div className="text-center space-y-6">
             
               
                {/* Loading message */}
                <div className="space-y-2">
                    <h2 className="text-2xl font-bold text-slate-900">Memuat Dashboard</h2>
                    <p className="text-slate-600 text-sm">Mengunduh data kualitas udara...</p>
                </div>
                
                {/* Animated dots */}
                <div className="flex justify-center gap-2">
                    <div className="w-3 h-3 bg-blue-500 rounded-full" style={{
                        animation: 'bounce 1.4s infinite',
                        animationDelay: '0s'
                    }}></div>
                    <div className="w-3 h-3 bg-blue-500 rounded-full" style={{
                        animation: 'bounce 1.4s infinite',
                        animationDelay: '0.2s'
                    }}></div>
                    <div className="w-3 h-3 bg-blue-500 rounded-full" style={{
                        animation: 'bounce 1.4s infinite',
                        animationDelay: '0.4s'
                    }}></div>
                </div>
              
                <style>{`
                    @keyframes pulse-gauge {
                        0%, 100% { stroke-dashoffset: 0; }
                        50% { stroke-dashoffset: -157; }
                    }
                    @keyframes bounce {
                        0%, 80%, 100% { transform: translateY(0); opacity: 1; }
                        40% { transform: translateY(-10px); opacity: 0.8; }
                    }
                    @keyframes slide {
                        0% { transform: translateX(-100%); }
                        50% { transform: translateX(500%); }
                        100% { transform: translateX(500%); }
                    }
                `}</style>
            </div>
        </div>
    );

    // Data for Gauge Chart
    const currentAQI = latest?.aqi || 0;
    const gaugeData = [
        { name: 'AQI', value: currentAQI },
        { name: 'Remaining', value: 300 - currentAQI } // Max 300
    ];

    // Dynamic gauge colors based on AQI category
    const getGaugeColors = (aqi) => {
        if (aqi <= 50) return ['#10b981', '#e2e8f0']; // Baik - hijau terang
        if (aqi <= 100) return ['#f59e0b', '#e2e8f0']; // Sedang - kuning
        if (aqi <= 200) return ['#f97316', '#e2e8f0']; // Tidak Sehat - orange
        if (aqi <= 300) return ['#dc2626', '#e2e8f0']; // Sangat Tidak Sehat - merah
        return ['#7f1d1d', '#e2e8f0']; // Berbahaya - merah tua
    };

    const gaugeColors = getGaugeColors(currentAQI);

    // AQI status label
    const getAQIStatusLabel = (aqi) => {
        if (aqi <= 50) return 'Baik';
        if (aqi <= 100) return 'Sedang';
        if (aqi <= 200) return 'Tidak Sehat';
        if (aqi <= 300) return 'Sangat Tidak Sehat';
        return 'Berbahaya';
    };

    // Hitung trend line menggunakan linear regression untuk satu nilai
    const calculateTrendLineForKey = (data, key) => {
        if (data.length < 2) return [];
        
        const n = data.length;
        const values = data.map(d => d[key]);
        const indices = Array.from({ length: n }, (_, i) => i);
        
        const meanX = indices.reduce((a, b) => a + b, 0) / n;
        const meanY = values.reduce((a, b) => a + b, 0) / n;
        
        const numerator = indices.reduce((sum, x, i) => sum + (x - meanX) * (values[i] - meanY), 0);
        const denominator = indices.reduce((sum, x) => sum + (x - meanX) ** 2, 0);
        
        if (denominator === 0) return {};
        
        const slope = numerator / denominator;
        const intercept = meanY - slope * meanX;
        
        const trendLine = {};
        data.forEach((d, i) => {
            trendLine[`trend_${key}`] = slope * i + intercept;
        });
        return trendLine;
    };

    // Hitung trend line menggunakan linear regression
    const calculateTrendLine = (data, keyName = 'value') => {
        if (data.length < 2) return [];
        
        const n = data.length;
        const values = data.map(d => d[keyName]);
        const indices = Array.from({ length: n }, (_, i) => i);
        
        const meanX = indices.reduce((a, b) => a + b, 0) / n;
        const meanY = values.reduce((a, b) => a + b, 0) / n;
        
        const numerator = indices.reduce((sum, x, i) => sum + (x - meanX) * (values[i] - meanY), 0);
        const denominator = indices.reduce((sum, x) => sum + (x - meanX) ** 2, 0);
        
        if (denominator === 0) return [];
        
        const slope = numerator / denominator;
        const intercept = meanY - slope * meanX;
        
        return data.map((d, i) => ({
            ...d,
            trend: slope * i + intercept
        }));
    };

    // Mock weekly data for bar chart - DINAMIS BERDASARKAN KATEGORI
    const getWeeklyData = () => {
        const selectedCat = filterCategories.find(cat => cat.key === selectedCategory);
        if (!selectedCat) return daily.map(d => ({ name: d.day, value: d.aqi }));

        const data = daily.map(d => ({
            name: d.day,
            value: d[selectedCat.dataKey],
            date: d.date,
            fullDate: new Date(d.date).toLocaleDateString('id-ID', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            }),
            shortDate: new Date(d.date).toLocaleDateString('id-ID', {
                month: 'short',
                day: 'numeric'
            }),
            co: d.mq7_ppm,
            co2: d.mq135_ppm,
            aqi: d.aqi
        }));
        
        // Tambahkan trend line
        if (selectedCategory === 'aqi') {
            // Untuk AQI, hitung trend untuk ketiga parameter
            return data.map((d, i) => {
                const indices = Array.from({ length: data.length }, (_, idx) => idx);
                
                // Hitung trend untuk CO
                const coValues = data.map(x => x.co);
                const meanX = indices.reduce((a, b) => a + b, 0) / data.length;
                const meanYCo = coValues.reduce((a, b) => a + b, 0) / data.length;
                const numCo = indices.reduce((sum, x, idx) => sum + (x - meanX) * (coValues[idx] - meanYCo), 0);
                const denomCo = indices.reduce((sum, x) => sum + (x - meanX) ** 2, 0);
                const slopeCo = denomCo !== 0 ? numCo / denomCo : 0;
                const interceptCo = meanYCo - slopeCo * meanX;
                
                // Hitung trend untuk CO2
                const co2Values = data.map(x => x.co2);
                const meanYCo2 = co2Values.reduce((a, b) => a + b, 0) / data.length;
                const numCo2 = indices.reduce((sum, x, idx) => sum + (x - meanX) * (co2Values[idx] - meanYCo2), 0);
                const denomCo2 = indices.reduce((sum, x) => sum + (x - meanX) ** 2, 0);
                const slopeCo2 = denomCo2 !== 0 ? numCo2 / denomCo2 : 0;
                const interceptCo2 = meanYCo2 - slopeCo2 * meanX;
                
                // Hitung trend untuk AQI
                const aqiValues = data.map(x => x.aqi);
                const meanYAqi = aqiValues.reduce((a, b) => a + b, 0) / data.length;
                const numAqi = indices.reduce((sum, x, idx) => sum + (x - meanX) * (aqiValues[idx] - meanYAqi), 0);
                const denomAqi = indices.reduce((sum, x) => sum + (x - meanX) ** 2, 0);
                const slopeAqi = denomAqi !== 0 ? numAqi / denomAqi : 0;
                const interceptAqi = meanYAqi - slopeAqi * meanX;
                
                return {
                    ...d,
                    trend_co: slopeCo * i + interceptCo,
                    trend_co2: slopeCo2 * i + interceptCo2,
                    trend_aqi: slopeAqi * i + interceptAqi
                };
            });
        } else {
            return calculateTrendLine(data);
        }
    };

    // Fungsi untuk mendapatkan data 24 jam berdasarkan hari yang dipilih
    const getDailyData = (selectedDate) => {
        if (!selectedDate) return [];

        const selectedCat = filterCategories.find(cat => cat.key === selectedCategory);
        if (!selectedCat) return [];

        const cachedHourly = hourlyPerDay[selectedDate];
        if (cachedHourly && cachedHourly.length > 0) {
            return cachedHourly.map(d => ({
                time: d.time,
                value: d[selectedCat.dataKey],
                hour: parseInt(d.time.split(':')[0]),
                fullTime: d.time
            }));
        }

        // Jika data belum tersedia, jangan tampilkan nilai mock.
        // Data akan di-fetch melalui useEffect ketika selectedDay berubah.
        return [];
    };

    const getLoadingWaveData = () => {
        const selectedCat = filterCategories.find(cat => cat.key === selectedCategory);
        const baseValue = selectedCat?.key === 'suhu' ? 26 :
            selectedCat?.key === 'kelembapan' ? 60 :
            selectedCat?.key === 'co' ? 5 :
            selectedCat?.key === 'co2' ? 420 : 50;
        const amplitude = selectedCat?.key === 'suhu' ? 2 :
            selectedCat?.key === 'kelembapan' ? 12 :
            selectedCat?.key === 'co' ? 1.2 :
            selectedCat?.key === 'co2' ? 18 : 15;

        return Array.from({ length: 24 }, (_, index) => {
            const value = baseValue + Math.sin((index / 23) * Math.PI * 2) * amplitude * 0.45
                + Math.cos((index / 11) * Math.PI * 2) * amplitude * 0.18;
            return {
                time: `${String(index).padStart(2, '0')}:00`,
                value: parseFloat(value.toFixed(selectedCat?.key === 'kelembapan' ? 0 : 1)),
                fullTime: `${String(index).padStart(2, '0')}:00`
            };
        });
    };

    // ✅ HANDLE KLIK BAR DENGAN ANIMASI
    const handleBarClick = (data) => {
        if (data && data.date) {
            // Jika klik bar yang sama, reset ke hari ini
            if (clickedBar === data.date) {
                setClickedBar(null);
                setIsBarInteracting(false);
                setSelectedDay(new Date().toISOString().split('T')[0]);
            } else {
                // Set clicked bar dan tetap sampai bar lain diklik
                setClickedBar(data.date);
                setIsBarInteracting(true);
                setSelectedDay(data.date);
            }
        }
    };

    const weeklyData = getWeeklyData();
    const dailyData = getDailyData(selectedDay);
    const selectedDayCached = hourlyPerDay[selectedDay];
    const hasSelectedDayData = selectedDayCached && selectedDayCached.length > 0;
    const chartLineData = selectedDay ? (hasSelectedDayData ? dailyData : getLoadingWaveData()) : weeklyData;

    return (
        <div className={`p-8 max-w-[1600px] mx-auto space-y-8 font-sans transition-colors duration-300 ${isBarInteracting ? 'bg-blue-50/20' : 'bg-transparent'}`}>
            <header className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-bold text-slate-900">
                    Dashboard Monitoring Kualitas Udara
                </h1>
                <div className="flex gap-2 items-center">
                    <div className={`text-xs px-3 py-1.5 rounded-full font-medium flex items-center gap-1 transition-all duration-300 ${
                        mqttConnected 
                            ? 'bg-green-100 text-green-700 shadow-sm' 
                            : 'bg-amber-100 text-amber-700 shadow-sm'
                    }`}>
                        <span className={`w-2 h-2 rounded-full ${mqttConnected ? 'bg-green-500' : 'bg-amber-500'}`}></span>
                        {mqttConnected ? 'MQTT Live' : 'Mock Data'}
                    </div>
                    <div className="relative filter-dropdown">
                        <button
                            onClick={() => setShowFilter(!showFilter)}
                            className="flex items-center gap-2 px-4 py-2 bg-white rounded-lg shadow-sm text-sm font-medium text-slate-600 hover:bg-slate-50 border border-slate-200"
                        >
                            <Filter size={16} />
                            Filter
                            <span className={`ml-1 transition-transform ${showFilter ? 'rotate-180' : ''}`}>▼</span>
                        </button>

                        {/* Filter Dropdown */}
                        {showFilter && (
                            <div className="absolute top-full mt-2 right-0 bg-white border border-slate-200 rounded-lg shadow-lg p-3 z-10 min-w-[200px]">
                                <div className="text-xs font-medium text-slate-500 mb-2">Pilih Kategori:</div>
                                <div className="space-y-1">
                                    {filterCategories.map(cat => (
                                        <button
                                            key={cat.key}
                                            onClick={() => {
                                                setSelectedCategory(cat.key);
                                                // Tetap pertahankan hari yang dipilih, atau default ke hari ini
                                                if (!selectedDay) {
                                                    setSelectedDay(new Date().toISOString().split('T')[0]);
                                                }
                                                setShowFilter(false);
                                            }}
                                            className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
                                                selectedCategory === cat.key
                                                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                                    : 'text-slate-600 hover:bg-slate-50'
                                            }`}
                                        >
                                            <cat.icon size={16} style={{ color: cat.color }} />
                                            {cat.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </header>

            {/* Row 1: Top Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Metric Cards */}
                <div className="lg:col-span-5 grid grid-cols-3 gap-4">
                    <div className="bg-yellow-100 rounded-2xl p-6 flex flex-col justify-between h-40">
                        <div className="flex items-center gap-2 text-slate-700">
                            <Thermometer size={20} /> <span className="text-sm font-medium">Suhu</span>
                        </div>
                        <div className="text-4xl font-bold text-slate-900">
                            {latest?.suhu?.toFixed(1)}<span className="text-xl align-top">°C</span>
                        </div>
                    </div>
                    <div className="bg-blue-500 rounded-2xl p-6 flex flex-col justify-between h-40 text-white">
                        <div className="flex items-center gap-2 opacity-90">
                            <Droplets size={20} /> <span className="text-sm font-medium">Kelembapan</span>
                        </div>
                        <div className="text-4xl font-bold">
                            {latest?.kelembapan?.toFixed(0)}%
                        </div>
                    </div>
                    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex flex-col justify-between h-40">
                        <div className="flex items-center gap-2 text-slate-700">
                            <Wind size={20} /> <span className="text-sm font-medium">AQI</span>
                        </div>
                        <div className="w-full flex items-center justify-center flex-1 relative">
                            <div className="h-24 w-full flex items-center justify-center">
                                <ResponsiveContainer width="100%" height={120} style={{ outline: 'none' }}>
                                    <PieChart>
                                        <Pie
                                            data={gaugeData}
                                            cx="50%"
                                            cy="60%"
                                            startAngle={180}
                                            endAngle={0}
                                            innerRadius={35}
                                            outerRadius={50}
                                            paddingAngle={0}
                                            dataKey="value"
                                            animationBegin={0}
                                            animationDuration={800}
                                            animationEasing="ease-out"
                                        >
                                            {gaugeData.map((entry, index) => (
                                                <Cell key={`cell - ${index} `} fill={gaugeColors[index]} stroke="none" />
                                            ))}
                                        </Pie>
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="absolute text-center mt-6">
                                <div className="text-3xl font-bold text-slate-900">{currentAQI}</div>
                                <div className="text-sm font-medium text-slate-700 mt-1">{getAQIStatusLabel(currentAQI)}</div>
                            </div>
                        </div>
                    </div>

                </div>

                {/* Status Message */}
                <div className="lg:col-span-7 bg-white rounded-2xl p-8 shadow-sm border border-slate-100 relative overflow-hidden">
                    <div className="flex justify-between items-start mb-2">
                        <h2 className="text-xl font-bold text-green-600">Udara dalam kondisi {getAQICategory(currentAQI)}!</h2>
                        <span className="text-sm text-slate-400 flex items-center gap-1">
                            ⏰ {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                    </div>
                   <p className="text-slate-600 text-sm leading-relaxed max-w-2xl">
                    {currentAQI <= 50 &&
                        "Kualitas udara di dalam ruangan saat ini sangat baik dan nyaman untuk beraktivitas. Cocok untuk bekerja, belajar, beristirahat, maupun berolahraga ringan tanpa perlu ventilasi tambahan 😄"}
                    {currentAQI > 50 && currentAQI <= 100 &&
                        "Kualitas udara di dalam ruangan masih tergolong aman untuk aktivitas sehari-hari. Namun, disarankan tetap menjaga sirkulasi udara agar ruangan tetap segar dan nyaman."}
                    {currentAQI > 100 && currentAQI <= 150 &&
                        "Kualitas udara di dalam ruangan mulai kurang sehat. Sebaiknya kurangi aktivitas fisik berat di dalam ruangan dan tingkatkan ventilasi atau gunakan air purifier jika tersedia."}
                    {currentAQI > 150 && currentAQI <= 200 &&
                        "Kualitas udara di dalam ruangan tidak sehat dan dapat menyebabkan rasa tidak nyaman seperti sesak atau pusing pada sebagian orang. Disarankan membuka ventilasi, menyalakan air purifier, dan membatasi aktivitas fisik berat."}
                    {currentAQI > 200 && currentAQI <= 300 &&
                        "Kualitas udara di dalam ruangan sangat tidak sehat. Hindari aktivitas berat, gunakan masker bila diperlukan, dan segera tingkatkan sirkulasi udara atau pindah ke ruangan dengan kualitas udara lebih baik."}
                    {currentAQI > 300 &&
                        "Kualitas udara di dalam ruangan berada pada tingkat berbahaya. Disarankan tetap berada di area dengan filtrasi udara yang baik, gunakan air purifier, dan hindari aktivitas yang memicu gangguan pernapasan."}
                </p>
                    <div className="mt-4 text-xs text-slate-400">
                        Terakhir update pada {new Date(latest?.updated_at || new Date()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                </div>
            </div>

            {/* Row 2: Main Chart */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Main Prediction Chart */}
                <div className="lg:col-span-12 bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="text-slate-700 font-medium">
                            {predictions && predictions.length > 0
                                ? `Prediksi 24 Jam Ke Depan - ${filterCategories.find(cat => cat.key === selectedCategory)?.label}`
                                : selectedCategory === 'aqi'
                                    ? 'Prediksi Kualitas Udara (AQI)'
                                    : `Prediksi ${filterCategories.find(cat => cat.key === selectedCategory)?.label}`
                            }
                        </h3>
                    </div>
                    <div className="w-full h-[250px]" style={{ outline: 'none' }}>
                        <ResponsiveContainer width="100%" height="100%" style={{ outline: 'none' }}>
                            {predictions && predictions.length > 0 ? (
                                <AreaChart data={predictions}>
                                    <defs>
                                        <linearGradient id="colorSplit" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor={filterCategories.find(cat => cat.key === selectedCategory)?.color || '#60a5fa'} stopOpacity={0.1} />
                                            <stop offset="95%" stopColor={filterCategories.find(cat => cat.key === selectedCategory)?.color || '#60a5fa'} stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                    <XAxis
                                        dataKey="time"
                                        axisLine={false}
                                        tickLine={false}
                                        tick={{ fill: '#94a3b8', fontSize: 11 }}
                                        interval={23}
                                        tickFormatter={(value) => {
                                            return value.split(':')[0]; // Ambil hanya jam dari "HH:MM"
                                        }}
                                    />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
                                    <Tooltip
                                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                        labelFormatter={(label, payload) => {
                                            if (payload && payload[0]) {
                                                const dataIndex = payload[0].payload;
                                                return `Jam ${new Date(dataIndex.waktu).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`;
                                            }
                                            return `Jam ${label}`;
                                        }}
                                        formatter={(value) => [
                                            `${value?.toFixed(selectedCategory === 'suhu' ? 1 : 0)} ${filterCategories.find(cat => cat.key === selectedCategory)?.unit || ''}`,
                                            filterCategories.find(cat => cat.key === selectedCategory)?.label || 'Value'
                                        ]}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey={filterCategories.find(cat => cat.key === selectedCategory)?.dataKey || 'aqi'}
                                        stroke={filterCategories.find(cat => cat.key === selectedCategory)?.color || '#60a5fa'}
                                        strokeWidth={2}
                                        fill="url(#colorSplit)"
                                    />
                                </AreaChart>
                            ) : (
                                <div className="flex items-center justify-center h-full text-slate-500">
                                    <div className="text-center">
                                        <Cloud size={48} className="mx-auto mb-4 opacity-50" />
                                        <p className="text-lg font-medium mb-2">Belum ada data prediksi</p>
                                        <p className="text-sm">Klik "Refresh Prediksi" untuk menjalankan model ML</p>
                                    </div>
                                </div>
                            )}
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* Row 3: Bottom Details */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Gas Metrics */}
                <div className="lg:col-span-3 space-y-4">
                    <div className="bg-orange-100 rounded-2xl p-6 shadow-sm border border-slate-100">
                        <div className="text-sm text-slate-600 mb-1">Karbon Dioksida</div>
                        <div className="font-bold text-slate-900">CO₂</div>
                        <div className="flex items-baseline justify-end mt-2">
                            <span className="text-3xl font-bold text-slate-800">{latest?.mq135_ppm?.toFixed(0)}</span>
                            <span className="text-xs text-slate-500 ml-1">PPM</span>
                        </div>
                    </div>
                    <div className="bg-red-100 rounded-2xl p-6 shadow-sm border border-slate-100">
                        <div className="text-sm text-slate-600 mb-1">Karbon Monoksida</div>
                        <div className="font-bold text-slate-900">CO</div>
                        <div className="flex items-baseline justify-end mt-2">
                            <span className="text-3xl font-bold text-slate-800">{latest?.mq7_ppm?.toFixed(0)}</span>
                            <span className="text-xs text-slate-500 ml-1">PPM</span>
                        </div>
                    </div>
                </div>

                {/* 7 Day Trend - Sekarang menampilkan 24 jam untuk hari yang dipilih */}
                <div className="lg:col-span-4 bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h3 className="text-lg font-medium text-slate-700">
                                Riwayat {filterCategories.find(cat => cat.key === selectedCategory)?.label} 24 Jam
                            </h3>
                            <p className="text-sm text-slate-500 mt-1">
                                {selectedDay
                                    ? weeklyData.find(d => d.date === selectedDay)?.fullDate || 'Hari Ini'
                                    : 'Hari Ini'
                                }
                            </p>
                        </div>
                        {selectedDay && selectedDay !== new Date().toISOString().split('T')[0] && (
                            <button
                                onClick={() => setSelectedDay(new Date().toISOString().split('T')[0])}
                                className="flex-shrink-0 px-4 py-2 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 hover:border-blue-300 transition-all duration-200 font-medium text-sm shadow-sm hover:shadow-md"
                            >
                                Hari Ini
                            </button>
                        )}
                    </div>
                    <div className="w-full h-[200px]" style={{ outline: 'none' }}>
                        <ResponsiveContainer width="100%" height="100%" style={{ outline: 'none' }}>
                            <LineChart data={chartLineData}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis
                                    dataKey={selectedDay ? "fullTime" : "name"}
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: '#94a3b8', fontSize: selectedDay ? 8 : 10 }}
                                    angle={selectedDay ? -45 : 0}
                                    textAnchor={selectedDay ? 'end' : 'middle'}
                                    height={selectedDay ? 60 : 40}
                                />
                                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                                <Tooltip
                                    formatter={(value) => [
                                        `${value?.toFixed(selectedCategory === 'suhu' ? 1 : 0)} ${filterCategories.find(cat => cat.key === selectedCategory)?.unit || ''}`,
                                        filterCategories.find(cat => cat.key === selectedCategory)?.label || 'Value'
                                    ]}
                                    labelFormatter={(label) => selectedDay ? `Jam ${label}` : `Hari ${label}`}
                                />
                                <Line
                                    type="monotone"
                                    dataKey="value"
                                    stroke={filterCategories.find(cat => cat.key === selectedCategory)?.color || '#60a5fa'}
                                    strokeWidth={2}
                                    dot={selectedDay ? { r: 3 } : false}
                                    animationActive={true}
                                    animationDuration={1200}
                                    animationEasing="ease"
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                    {selectedDay && dailyData.length === 0 && !selectedDayCached && (
                        <div className="text-xs text-slate-500 mt-2 text-center">
                            Memuat data 24 jam untuk {selectedDay}...
                        </div>
                    )}
                    {selectedDay && dailyData.length === 0 && selectedDayCached && selectedDayCached.length === 0 && (
                        <div className="text-xs text-slate-500 mt-2 text-center">
                            Data 24 jam belum tersedia untuk tanggal ini.
                        </div>
                    )}
                    {selectedDay === new Date().toISOString().split('T')[0] && selectedDayCached && selectedDayCached.length > 0 && (
                        <div className="text-xs text-slate-500 mt-2 text-center">
                            Menampilkan data 24 jam terakhir hari ini
                        </div>
                    )}
                    {selectedDay && selectedDay !== new Date().toISOString().split('T')[0] && (
                        <div className="text-xs text-slate-500 mt-2 text-center">
                            Klik "Hari Ini" untuk kembali ke data terkini
                        </div>
                    )}
                </div>

                {/* Comparison Bar Chart - Sekarang bisa diklik untuk pilih hari */}
                    <div className={`lg:col-span-5 bg-white rounded-2xl p-6 shadow-sm border border-slate-100 transition-all duration-300 ease-out overflow-hidden bar-chart-container ${isBarInteracting ? 'shadow-lg shadow-blue-200' : ''}`}>
                    <h3 className={`text-center text-slate-700 font-medium mb-4 transition-colors duration-300 ${isBarInteracting ? 'text-blue-700' : ''}`}>
                        {selectedCategory === 'aqi'
                            ? 'Perbandingan CO, CO₂, dan AQI (7 Hari)'
                            : `Rata-Rata Harian ${filterCategories.find(cat => cat.key === selectedCategory)?.label} (7 Hari)`
                        }
                    </h3>
                    <div className={`w-full h-[200px] overflow-hidden transition-all duration-300 ease-out ${selectedCategory !== 'aqi' ? 'cursor-pointer' : ''}`} style={{ outline: 'none' }}>
                        <ResponsiveContainer width="100%" height="100%" style={{ outline: 'none' }}>
                            {selectedCategory === 'aqi' ? (
                                <ComposedChart 
                                    data={weeklyData} 
                                    barGap={1} 
                                    barCategoryGap={2}
                                >
                                    <CartesianGrid vertical={false} stroke="#f1f5f9" />
                                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                                    <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                                    <Tooltip content={<CustomTooltip />} />
                                    <Bar
                                        yAxisId="left"
                                        dataKey="co"
                                        fill="#E74C3C"
                                        radius={[2, 2, 2, 2]}
                                        barSize={10}
                                    />
                                    <Bar
                                        yAxisId="left"
                                        dataKey="co2"
                                        fill="#F39C12"
                                        radius={[2, 2, 2, 2]}
                                        barSize={10}
                                    />
                                    <Bar
                                        yAxisId="left"
                                        dataKey="aqi"
                                        fill="#2ECC71"
                                        radius={[2, 2, 2, 2]}
                                        barSize={10}
                                    />
                                    <Line
                                        yAxisId="left"
                                        type="monotone"
                                        dataKey="trend_co"
                                        stroke="#C0392B"
                                        strokeWidth={2}
                                        dot={false}
                                        isAnimationActive={true}
                                        animationDuration={1200}
                                        animationEasing="ease"
                                    />
                                    <Line
                                        yAxisId="left"
                                        type="monotone"
                                        dataKey="trend_co2"
                                        stroke="#D68910"
                                        strokeWidth={2}
                                        dot={false}
                                        isAnimationActive={true}
                                        animationDuration={1200}
                                        animationEasing="ease"
                                    />
                                    <Line
                                        yAxisId="left"
                                        type="monotone"
                                        dataKey="trend_aqi"
                                        stroke="#27AE60"
                                        strokeWidth={2}
                                        dot={false}
                                        isAnimationActive={true}
                                        animationDuration={1200}
                                        animationEasing="ease"
                                    />
                                </ComposedChart>
                            ) : (
                                <ComposedChart 
                                    data={weeklyData} 
                                    barGap={0} 
                                    barCategoryGap={1}
                                    onMouseEnter={() => !clickedBar && setIsBarInteracting(true)}
                                    onMouseLeave={() => {
                                        if (!clickedBar) {
                                            setIsBarInteracting(false);
                                        }
                                    }}
                                >
                                    <CartesianGrid vertical={false} stroke="#f1f5f9" />
                                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                                    <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                                    <Tooltip content={<CustomTooltip />} />
                                    <Bar
                                        yAxisId="left"
                                        dataKey="value"
                                        fill={filterCategories.find(cat => cat.key === selectedCategory)?.color || '#60a5fa'}
                                        radius={[2, 2, 0, 0]}
                                        barSize={16}
                                        onClick={handleBarClick}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        {weeklyData.map((entry, index) => (
                                            <Cell 
                                                key={`cell-${index}`} 
                                                fill={clickedBar === entry.date ? '#fbbf24' : (filterCategories.find(cat => cat.key === selectedCategory)?.color || '#60a5fa')}
                                                style={{
                                                    transition: 'fill 0.3s ease, opacity 0.3s ease, filter 0.3s ease',
                                                    filter: clickedBar === entry.date ? 'drop-shadow(0 4px 12px rgba(251, 191, 36, 0.6))' : 'none',
                                                    opacity: clickedBar && clickedBar !== entry.date ? 0.65 : 1
                                                }}
                                            />
                                        ))}
                                    </Bar>
                                    <Line
                                        yAxisId="left"
                                        type="monotone"
                                        dataKey="trend"
                                        stroke="#6366f1"
                                        strokeWidth={2}
                                        dot={false}
                                        isAnimationActive={true}
                                        animationDuration={1200}
                                        animationEasing="ease"
                                    />
                                </ComposedChart>
                            )}
                        </ResponsiveContainer>
                    </div>
                    {selectedCategory !== 'aqi' && (
                        <div className={`text-xs text-slate-500 mt-3 text-center transition-all duration-300 ${isBarInteracting ? 'text-blue-600 font-medium' : ''}`}>
                            Klik bar untuk melihat data 24 jam hari tersebut
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
