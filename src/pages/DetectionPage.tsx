import { Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import {
  useAudioEngine,
  useRoomClassifier,
  useRooms,
} from '../hooks';
import { ChirpMode } from '../audio';
import { PredictionResult } from '../ml';

type DetectionState = 'idle' | 'listening' | 'processing' | 'result' | 'error';

interface Alternative {
  roomId: string;
  probability: number;
}

export default function DetectionPage() {
  const { state: audioState, capture, requestPermission, reset: resetAudio } = useAudioEngine();
  const { state: classifierState, predict } = useRoomClassifier();
  const { state: roomsState, getRoomById } = useRooms();

  const [detectionState, setDetectionState] = useState<DetectionState>('idle');
  const [chirpMode, setChirpMode] = useState<ChirpMode>('audible');
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [detectedRoomName, setDetectedRoomName] = useState<string | null>(null);
  const [alternatives, setAlternatives] = useState<Alternative[]>([]);
  const [error, setError] = useState<string | null>(null);

  const hasModel = classifierState.modelState === 'ready';

  // Update detection state based on audio state
  useEffect(() => {
    if (audioState.captureState === 'capturing') {
      setDetectionState('listening');
    } else if (audioState.captureState === 'processing') {
      setDetectionState('processing');
    }
  }, [audioState.captureState]);

  const handleDetect = async () => {
    if (!hasModel) {
      setError('No model trained. Please train a model first.');
      setDetectionState('error');
      return;
    }

    // Request permission if needed
    if (!audioState.hasPermission) {
      const granted = await requestPermission();
      if (!granted) {
        setError('Microphone permission denied');
        setDetectionState('error');
        return;
      }
    }

    setError(null);
    setPrediction(null);
    setDetectedRoomName(null);
    setAlternatives([]);
    resetAudio();

    // Capture audio
    const features = await capture(chirpMode);

    if (!features) {
      setError(audioState.error || 'Failed to capture audio');
      setDetectionState('error');
      return;
    }

    // Run prediction
    setDetectionState('processing');
    const result = await predict(features.raw);

    if (!result) {
      setError(classifierState.error || 'Prediction failed');
      setDetectionState('error');
      return;
    }

    // Look up room name
    const room = getRoomById(result.predictedRoomId);
    setDetectedRoomName(room?.name || result.predictedRoomId);
    setPrediction(result);

    // Compute alternatives from allProbabilities
    const alts: Alternative[] = [];
    result.allProbabilities.forEach((prob, roomId) => {
      if (roomId !== result.predictedRoomId) {
        alts.push({ roomId, probability: prob });
      }
    });
    alts.sort((a, b) => b.probability - a.probability);
    setAlternatives(alts);

    setDetectionState('result');
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'text-green-400';
    if (confidence >= 0.6) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getConfidenceLabel = (confidence: number) => {
    if (confidence >= 0.8) return 'High confidence';
    if (confidence >= 0.6) return 'Medium confidence';
    return 'Low confidence';
  };

  return (
    <div className="page safe-top">
      {/* Header */}
      <header className="flex items-center gap-4 mb-6">
        <Link to="/" className="btn-ghost p-2">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-xl font-bold">Detect Room</h1>
      </header>

      <div className="max-w-md mx-auto">
        {/* Detection Area */}
        <div className="card text-center py-12">
          {detectionState === 'idle' && (
            <>
              <div className="w-32 h-32 mx-auto mb-6 rounded-full bg-dark-700 flex items-center justify-center">
                <svg className="w-16 h-16 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </div>
              <p className="text-gray-400 mb-6">
                {hasModel ? 'Tap to detect which room you\'re in' : 'Train a model to start detecting'}
              </p>
            </>
          )}

          {detectionState === 'listening' && (
            <>
              <div className="w-32 h-32 mx-auto mb-6 rounded-full bg-primary-600/20 flex items-center justify-center animate-pulse-slow glow-primary">
                <div className="w-24 h-24 rounded-full bg-primary-600/40 flex items-center justify-center">
                  <svg className="w-12 h-12 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                </div>
              </div>
              <p className="text-primary-400 mb-6">Emitting chirp & listening...</p>
            </>
          )}

          {detectionState === 'processing' && (
            <>
              <div className="w-32 h-32 mx-auto mb-6 rounded-full bg-accent-600/20 flex items-center justify-center">
                <div className="w-12 h-12 border-4 border-accent-500 border-t-transparent rounded-full animate-spin" />
              </div>
              <p className="text-accent-400 mb-6">Analyzing acoustic signature...</p>
            </>
          )}

          {detectionState === 'result' && prediction && (
            <>
              <div className={`w-32 h-32 mx-auto mb-6 rounded-full flex items-center justify-center ${
                prediction.confidence >= 0.6 ? 'bg-accent-600/20 glow-accent' : 'bg-yellow-600/20'
              }`}>
                <svg className={`w-16 h-16 ${prediction.confidence >= 0.6 ? 'text-accent-400' : 'text-yellow-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
              </div>
              <h2 className={`text-2xl font-bold mb-2 ${prediction.confidence >= 0.6 ? 'text-accent-400' : 'text-yellow-400'}`}>
                {detectedRoomName}
              </h2>
              <p className={`text-lg font-medium mb-1 ${getConfidenceColor(prediction.confidence)}`}>
                {(prediction.confidence * 100).toFixed(0)}% confidence
              </p>
              <p className="text-sm text-gray-500 mb-4">
                {getConfidenceLabel(prediction.confidence)}
              </p>

              {/* Alternative predictions */}
              {alternatives.length > 0 && (
                <div className="mt-4 pt-4 border-t border-dark-600">
                  <p className="text-xs text-gray-500 mb-2">Other possibilities:</p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {alternatives.slice(0, 3).map((alt, idx) => {
                      const altRoom = getRoomById(alt.roomId);
                      return (
                        <span key={idx} className="text-xs bg-dark-700 px-2 py-1 rounded">
                          {altRoom?.name || alt.roomId}: {(alt.probability * 100).toFixed(0)}%
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {detectionState === 'error' && (
            <>
              <div className="w-32 h-32 mx-auto mb-6 rounded-full bg-red-600/20 flex items-center justify-center">
                <svg className="w-16 h-16 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-red-400 mb-2">Detection Failed</h2>
              <p className="text-gray-400 mb-6">{error}</p>
            </>
          )}

          <button
            onClick={handleDetect}
            disabled={detectionState === 'listening' || detectionState === 'processing'}
            className={`btn-primary w-full text-lg py-4 ${
              detectionState === 'idle' && hasModel ? 'glow-primary' : ''
            } ${!hasModel ? 'opacity-50' : ''}`}
          >
            {detectionState === 'idle' && 'Detect Room'}
            {detectionState === 'listening' && 'Listening...'}
            {detectionState === 'processing' && 'Processing...'}
            {detectionState === 'result' && 'Detect Again'}
            {detectionState === 'error' && 'Try Again'}
          </button>
        </div>

        {/* Mode Selector */}
        <div className="card mt-6">
          <h2 className="section-title">Detection Mode</h2>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setChirpMode('audible')}
              className={`btn-secondary text-sm py-3 ${
                chirpMode === 'audible' ? 'border-primary-500 bg-primary-600/10' : ''
              }`}
            >
              <div className={`font-medium ${chirpMode === 'audible' ? 'text-primary-400' : ''}`}>
                Audible
              </div>
              <div className="text-xs text-gray-500">High accuracy</div>
            </button>
            <button
              onClick={() => setChirpMode('ultrasonic')}
              className={`btn-secondary text-sm py-3 ${
                chirpMode === 'ultrasonic' ? 'border-primary-500 bg-primary-600/10' : ''
              }`}
            >
              <div className={`font-medium ${chirpMode === 'ultrasonic' ? 'text-primary-400' : ''}`}>
                Ultrasonic
              </div>
              <div className="text-xs text-gray-500">Less audible</div>
            </button>
          </div>
        </div>

        {/* Model Info / No Model Warning */}
        {hasModel ? (
          <div className="card mt-6 border-green-600/50 bg-green-600/10">
            <div className="flex gap-3">
              <svg className="w-6 h-6 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h3 className="font-medium text-green-500">Model Ready</h3>
                <p className="text-sm text-gray-400 mt-1">
                  {classifierState.modelInfo?.roomCount} rooms trained, {((classifierState.modelInfo?.accuracy || 0) * 100).toFixed(0)}% accuracy
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="card mt-6 border-yellow-600/50 bg-yellow-600/10">
            <div className="flex gap-3">
              <svg className="w-6 h-6 text-yellow-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <h3 className="font-medium text-yellow-500">No Model Trained</h3>
                <p className="text-sm text-gray-400 mt-1">
                  Go to Training to add rooms and train the classifier.
                </p>
                <Link to="/training" className="text-sm text-primary-400 hover:text-primary-300 mt-2 inline-block">
                  Go to Training →
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Recent Rooms */}
        {roomsState.rooms.length > 0 && (
          <div className="card mt-6">
            <h2 className="section-title">Trained Rooms</h2>
            <div className="flex flex-wrap gap-2">
              {roomsState.rooms.map((room) => (
                <span
                  key={room.id}
                  className="text-sm bg-dark-700 px-3 py-1 rounded-full text-gray-300"
                >
                  {room.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
