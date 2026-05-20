import axios from 'axios';

const api = axios.create({
    baseURL: 'http://103.253.212.156/api',
    headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    },
});

export const getLatestPrediction = () =>
    api.get('/predictions').then(res => res.data.data);

export default api;