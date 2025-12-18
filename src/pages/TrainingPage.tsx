import { Link } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import {
  useRooms,
  useAudioEngine,
  useSamples,
  useRoomClassifier,
  RoomWithSampleCount,
  OrientationStats,
} from '../hooks';
import { ChirpMode } from '../audio';
import OrientationSphere from '../components/OrientationSphere';

type ViewState = 'list' | 'add-room' | 'capture' | 'training';
type CaptureModeUI = 'chirp-audible' | 'chirp-ultrasonic' | 'ambient';

export default function TrainingPage() {
  const { state: roomsState, addRoom, removeRoom, refreshRooms } = useRooms();
  const {
    state: audioState,
    capture,
    captureAmbient,
    requestPermission,
    requestOrientationPermission,
    startOrientationTracking,
    stopOrientationTracking,
    reset: resetAudio
  } = useAudioEngine();
  const { state: samplesState, addSample, getTrainingData, refreshSamples, getOrientationStats, getSamplesForRoom } = useSamples();
  const { state: classifierState, train } = useRoomClassifier();

  const [viewState, setViewState] = useState<ViewState>('list');
  const [newRoomName, setNewRoomName] = useState('');
  const [selectedRoom, setSelectedRoom] = useState<RoomWithSampleCount | null>(null);
  const [captureMode, setCaptureMode] = useState<CaptureModeUI>('chirp-audible');
  const [includeOrientation, setIncludeOrientation] = useState(true);
  const [captureCount, setCaptureCount] = useState(0);
  const [orientationStats, setOrientationStats] = useState<OrientationStats | null>(null);
  const [allRoomsOrientationWarnings, setAllRoomsOrientationWarnings] = useState<string[]>([]);
  const [sampleOrientations, setSampleOrientations] = useState<Array<[number, number, number]>>([]);

  // Refresh orientation stats when room changes or capture happens
  const refreshOrientationStats = useCallback(async () => {
    if (selectedRoom) {
      const stats = await getOrientationStats(selectedRoom.id);
      setOrientationStats(stats);
    }
  }, [selectedRoom, getOrientationStats]);

  // Load sample orientations for 3D sphere visualization
  const loadSampleOrientations = useCallback(async () => {
    if (selectedRoom) {
      const samples = await getSamplesForRoom(selectedRoom.id);
      const orientations = samples
        .map(s => s.features.orientation)
        .filter((o): o is [number, number, number] => o !== undefined);
      setSampleOrientations(orientations);
    } else {
      setSampleOrientations([]);
    }
  }, [selectedRoom, getSamplesForRoom]);

  // Check orientation diversity across all rooms when on list view
  const checkAllRoomsOrientationDiversity = useCallback(async () => {
    const warnings: string[] = [];
    for (const room of roomsState.rooms) {
      if (room.sampleCount > 0) {
        const stats = await getOrientationStats(room.id);
        if (stats.samplesWithOrientation > 0) {
          if (stats.diversityScore < 0.4) {
            warnings.push(`"${room.name}": Low orientation diversity (${Math.round(stats.diversityScore * 100)}%)`);
          } else if (stats.overallCoverage < 0.5) {
            warnings.push(`"${room.name}": Limited orientation coverage`);
          }
        }
      }
    }
    setAllRoomsOrientationWarnings(warnings);
  }, [roomsState.rooms, getOrientationStats]);

  // Refresh stats and load sample orientations when entering capture mode or after capture
  useEffect(() => {
    if (viewState === 'capture' && selectedRoom) {
      refreshOrientationStats();
      loadSampleOrientations();
    }
  }, [viewState, selectedRoom, captureCount, refreshOrientationStats, loadSampleOrientations]);

  // Start/stop orientation tracking when entering/exiting capture mode
  useEffect(() => {
    if (viewState === 'capture' && includeOrientation) {
      // Request permission on iOS if needed, then start tracking
      if (audioState.needsOrientationPermission && audioState.orientationPermissionGranted === null) {
        // Permission will be requested on first capture button press
        console.log('[TrainingPage] iOS orientation permission needed, will request on capture');
      } else {
        startOrientationTracking();
      }
    } else {
      stopOrientationTracking();
    }

    return () => {
      stopOrientationTracking();
    };
  }, [viewState, includeOrientation, audioState.needsOrientationPermission, audioState.orientationPermissionGranted, startOrientationTracking, stopOrientationTracking]);

  // Check all rooms orientation when on list view
  useEffect(() => {
    if (viewState === 'list' && roomsState.rooms.length > 0) {
      checkAllRoomsOrientationDiversity();
    }
  }, [viewState, roomsState.rooms, checkAllRoomsOrientationDiversity]);

  // Refresh rooms when samples change
  useEffect(() => {
    if (viewState === 'list') {
      refreshRooms();
    }
  }, [viewState, refreshRooms]);

  // Handle adding a new room
  const handleAddRoom = async () => {
    if (!newRoomName.trim()) return;

    const room = await addRoom(newRoomName.trim());
    if (room) {
      setNewRoomName('');
      setViewState('list');
    }
  };

  // Handle starting capture for a room
  const handleStartCapture = async (room: RoomWithSampleCount) => {
    console.log('[TrainingPage] handleStartCapture called for room:', room.name);
    setSelectedRoom(room);
    setCaptureCount(0);

    // Request permission if needed
    if (!audioState.hasPermission) {
      console.log('[TrainingPage] Requesting microphone permission...');
      const granted = await requestPermission();
      if (!granted) {
        console.log('[TrainingPage] Permission denied');
        return;
      }
      console.log('[TrainingPage] Permission granted');
    }

    console.log('[TrainingPage] Setting viewState to capture');
    setViewState('capture');
  };

  // Handle a single capture
  const handleCapture = async () => {
    console.log('[TrainingPage] handleCapture called, selectedRoom:', selectedRoom?.name, 'mode:', captureMode);
    if (!selectedRoom) {
      console.error('[TrainingPage] No room selected!');
      return;
    }

    // Request iOS orientation permission if needed (must be in a user gesture handler)
    if (includeOrientation && audioState.needsOrientationPermission && audioState.orientationPermissionGranted === null) {
      console.log('[TrainingPage] Requesting iOS orientation permission...');
      const granted = await requestOrientationPermission();
      if (granted) {
        startOrientationTracking();
      }
    }

    resetAudio();

    if (captureMode === 'ambient') {
      // Ambient capture (passive, no chirp)
      console.log('[TrainingPage] Calling captureAmbient...');
      const features = await captureAmbient(3, includeOrientation);
      console.log('[TrainingPage] Ambient capture result:', features ? 'success' : 'failed');

      if (features) {
        // Get orientation from the capture (now captured at start of capture)
        const orientation = audioState.lastOrientation
          ? [
              (audioState.lastOrientation.alpha ?? 0) / 360,
              ((audioState.lastOrientation.beta ?? 0) + 180) / 360,
              ((audioState.lastOrientation.gamma ?? 0) + 90) / 180,
            ] as [number, number, number]
          : undefined;

        console.log('[TrainingPage] Orientation captured:', orientation);
        console.log('[TrainingPage] Saving ambient sample...');
        await addSample(selectedRoom.id, {
          mode: 'ambient-manual',
          ambientFeatures: features.raw,
          orientation,
          raw: features.raw,
        }, {
          captureMode: 'ambient-manual',
          duration: 3000, // 3 seconds
          sampleRate: 48000,
          deviceInfo: navigator.userAgent,
          hasOrientation: !!orientation,
        });

        setCaptureCount((c) => c + 1);
        await refreshRooms();
        console.log('[TrainingPage] Ambient sample saved successfully');
      } else {
        console.error('[TrainingPage] Ambient capture returned null');
      }
    } else {
      // Chirp capture (active)
      const selectedChirpMode: ChirpMode = captureMode === 'chirp-ultrasonic' ? 'ultrasonic' : 'audible';
      console.log('[TrainingPage] Calling capture with chirp mode:', selectedChirpMode);
      const features = await capture(selectedChirpMode, includeOrientation);
      console.log('[TrainingPage] Capture result:', features ? 'success' : 'failed');

      if (features) {
        // Get orientation from the capture (now captured at start of capture)
        const orientation = audioState.lastOrientation
          ? [
              (audioState.lastOrientation.alpha ?? 0) / 360,
              ((audioState.lastOrientation.beta ?? 0) + 180) / 360,
              ((audioState.lastOrientation.gamma ?? 0) + 90) / 180,
            ] as [number, number, number]
          : undefined;

        console.log('[TrainingPage] Orientation captured:', orientation);
        console.log('[TrainingPage] Saving chirp sample...');
        await addSample(selectedRoom.id, {
          mode: 'chirp',
          chirpFeatures: features.raw,
          orientation,
          raw: features.raw,
        }, {
          captureMode: 'chirp',
          chirpMode: selectedChirpMode,
          duration: selectedChirpMode === 'audible' ? 500 : 300,
          sampleRate: 48000,
          deviceInfo: navigator.userAgent,
          hasOrientation: !!orientation,
        });

        setCaptureCount((c) => c + 1);
        await refreshRooms();
        console.log('[TrainingPage] Chirp sample saved successfully');
      } else {
        console.error('[TrainingPage] Capture returned null, check audioState.error');
      }
    }
  };

  // Handle training
  const handleTrain = async () => {
    setViewState('training');

    const { features, labels, roomIds } = await getTrainingData();
    await train(features, labels, roomIds);
    await refreshSamples();

    // Stay on training view to show results
  };

  // Handle deleting a room
  const handleDeleteRoom = async (roomId: string) => {
    if (confirm('Delete this room and all its samples?')) {
      await removeRoom(roomId);
    }
  };

  // Render Add Room Modal
  if (viewState === 'add-room') {
    return (
      <div className="page safe-top">
        <header className="flex items-center gap-4 mb-6">
          <button onClick={() => setViewState('list')} className="btn-ghost p-2">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-xl font-bold">Add Room</h1>
        </header>

        <div className="max-w-md mx-auto">
          <div className="card">
            <label className="block mb-2 text-sm font-medium text-gray-300">
              Room Name
            </label>
            <input
              type="text"
              value={newRoomName}
              onChange={(e) => setNewRoomName(e.target.value)}
              placeholder="e.g., Living Room, Kitchen"
              className="w-full px-4 py-3 bg-dark-700 border border-dark-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-primary-500"
              autoFocus
            />

            {roomsState.error && (
              <p className="mt-2 text-sm text-red-400">{roomsState.error}</p>
            )}

            <button
              onClick={handleAddRoom}
              disabled={!newRoomName.trim()}
              className="btn-primary w-full mt-4"
            >
              Create Room
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Render Capture View
  if (viewState === 'capture' && selectedRoom) {
    return (
      <div className="page safe-top">
        <header className="flex items-center gap-4 mb-6">
          <button onClick={() => setViewState('list')} className="btn-ghost p-2">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-xl font-bold">Capture: {selectedRoom.name}</h1>
        </header>

        <div className="max-w-md mx-auto">
          {/* Capture Status with 3D Orientation Sphere */}
          <div className="card mb-6">
            <div className="flex items-center justify-between gap-4">
              {/* Sample count */}
              <div className="text-center flex-1">
                <div className="text-5xl font-bold text-primary-400 mb-1">
                  {selectedRoom.sampleCount + captureCount}
                </div>
                <p className="text-gray-400 text-sm">samples</p>
                {captureCount > 0 && (
                  <p className="text-xs text-accent-400">+{captureCount} this session</p>
                )}
              </div>

              {/* 3D Orientation Sphere */}
              {includeOrientation && (
                <div className="flex-shrink-0">
                  <OrientationSphere
                    currentOrientation={audioState.currentOrientation}
                    sampleOrientations={sampleOrientations}
                    size={130}
                    showLabels={true}
                  />
                </div>
              )}
            </div>

            {/* Orientation diversity stats (compact) */}
            {includeOrientation && orientationStats && orientationStats.samplesWithOrientation > 0 && (
              <div className="mt-4 pt-4 border-t border-dark-600">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-gray-400">Diversity Score</span>
                  <span className={`font-medium ${
                    orientationStats.diversityScore >= 0.7 ? 'text-green-400' :
                    orientationStats.diversityScore >= 0.4 ? 'text-yellow-400' : 'text-red-400'
                  }`}>
                    {Math.round(orientationStats.diversityScore * 100)}%
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs mt-1">
                  <span className="text-gray-400">Coverage (N/E/S/W)</span>
                  <span className="text-gray-300">
                    {orientationStats.quadrantCounts.north}/{orientationStats.quadrantCounts.east}/{orientationStats.quadrantCounts.south}/{orientationStats.quadrantCounts.west}
                  </span>
                </div>
                {orientationStats.warnings.length > 0 && (
                  <p className="text-xs text-yellow-400 mt-2">
                    {orientationStats.warnings[0]}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Capture Mode Selection */}
          <div className="card mb-6">
            <h2 className="section-title">Capture Mode</h2>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => setCaptureMode('chirp-audible')}
                className={`py-2 px-3 rounded-lg transition-colors text-sm ${
                  captureMode === 'chirp-audible'
                    ? 'bg-primary-600 text-white'
                    : 'bg-dark-700 text-gray-400'
                }`}
              >
                Chirp
              </button>
              <button
                onClick={() => setCaptureMode('chirp-ultrasonic')}
                className={`py-2 px-3 rounded-lg transition-colors text-sm ${
                  captureMode === 'chirp-ultrasonic'
                    ? 'bg-primary-600 text-white'
                    : 'bg-dark-700 text-gray-400'
                }`}
              >
                Ultrasonic
              </button>
              <button
                onClick={() => setCaptureMode('ambient')}
                className={`py-2 px-3 rounded-lg transition-colors text-sm ${
                  captureMode === 'ambient'
                    ? 'bg-accent-600 text-white'
                    : 'bg-dark-700 text-gray-400'
                }`}
              >
                Ambient
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              {captureMode === 'chirp-audible' && 'Active chirp (200Hz-18kHz) - Best accuracy'}
              {captureMode === 'chirp-ultrasonic' && 'High-freq chirp (15-20kHz) - Less audible'}
              {captureMode === 'ambient' && 'Passive recording (3s) - No sound emitted'}
            </p>
          </div>

          {/* Orientation Toggle */}
          {audioState.hasOrientationSupport && (
            <div className="card mb-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-medium text-white">Include Orientation</h2>
                  <p className="text-xs text-gray-500">Use device tilt as feature input</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium ${includeOrientation ? 'text-primary-400' : 'text-gray-500'}`}>
                    {includeOrientation ? 'ON' : 'OFF'}
                  </span>
                  <button
                    onClick={() => setIncludeOrientation(!includeOrientation)}
                    className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                      includeOrientation ? 'bg-primary-600' : 'bg-dark-600'
                    }`}
                    role="switch"
                    aria-checked={includeOrientation}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
                        includeOrientation ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Capture Button */}
          <button
            onClick={handleCapture}
            disabled={audioState.captureState === 'capturing' || audioState.captureState === 'processing'}
            className={`w-full py-6 rounded-xl text-xl font-bold transition-all ${
              audioState.captureState === 'capturing' || audioState.captureState === 'processing'
                ? 'bg-accent-600 text-white animate-pulse'
                : captureMode === 'ambient'
                  ? 'bg-accent-600 hover:bg-accent-500 text-white glow-accent'
                  : 'bg-primary-600 hover:bg-primary-500 text-white glow-primary'
            }`}
          >
            {audioState.captureState === 'idle' && (
              <span className="flex items-center justify-center gap-3">
                {captureMode === 'ambient' ? (
                  <>
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                    </svg>
                    Record Ambient (3s)
                  </>
                ) : (
                  <>
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                    Tap to Capture
                  </>
                )}
              </span>
            )}
            {audioState.captureState === 'capturing' && (captureMode === 'ambient' ? 'Recording...' : 'Listening...')}
            {audioState.captureState === 'processing' && 'Processing...'}
            {audioState.captureState === 'complete' && (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Saved! Tap for more
              </span>
            )}
          </button>

          {audioState.error && (
            <p className="mt-4 text-center text-red-400 text-sm">{audioState.error}</p>
          )}

          {/* Tips */}
          <div className="card mt-6">
            <h2 className="section-title">Capture Tips</h2>
            <ul className="text-sm text-gray-400 space-y-2">
              {captureMode === 'ambient' ? (
                <>
                  <li className="flex gap-2">
                    <span className="text-accent-400">•</span>
                    Captures room's ambient sound profile
                  </li>
                  <li className="flex gap-2">
                    <span className="text-accent-400">•</span>
                    Works well with HVAC, appliance hum
                  </li>
                  <li className="flex gap-2">
                    <span className="text-accent-400">•</span>
                    Keep phone still for 3 seconds
                  </li>
                </>
              ) : (
                <>
                  <li className="flex gap-2">
                    <span className="text-accent-400">•</span>
                    Hold phone steady at chest height
                  </li>
                  <li className="flex gap-2">
                    <span className="text-accent-400">•</span>
                    Try different positions in the room
                  </li>
                  <li className="flex gap-2">
                    <span className="text-accent-400">•</span>
                    {captureMode === 'chirp-ultrasonic'
                      ? 'Speaker must support 15-20kHz'
                      : 'Minimize background noise'}
                  </li>
                </>
              )}
              {includeOrientation && audioState.hasOrientationSupport && (
                <li className="flex gap-2">
                  <span className="text-primary-400">•</span>
                  Orientation will be recorded as feature
                </li>
              )}
            </ul>
          </div>

          {/* Done Button */}
          <button
            onClick={() => setViewState('list')}
            className="btn-secondary w-full mt-4"
          >
            Done Capturing
          </button>
        </div>
      </div>
    );
  }

  // Render Training View
  if (viewState === 'training') {
    const progress = classifierState.trainingProgress;
    const result = classifierState.lastTrainingResult;

    return (
      <div className="page safe-top">
        <header className="flex items-center gap-4 mb-6">
          <button onClick={() => setViewState('list')} className="btn-ghost p-2">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-xl font-bold">Training Model</h1>
        </header>

        <div className="max-w-md mx-auto">
          <div className="card">
            {classifierState.isTraining && progress && (
              <>
                <div className="text-center mb-6">
                  <div className="text-4xl font-bold text-primary-400 mb-1">
                    {Math.round((progress.epoch / progress.totalEpochs) * 100)}%
                  </div>
                  <p className="text-gray-400">
                    Epoch {progress.epoch}/{progress.totalEpochs}
                  </p>
                </div>

                {/* Progress Bar */}
                <div className="w-full h-3 bg-dark-700 rounded-full overflow-hidden mb-4">
                  <div
                    className="h-full bg-gradient-to-r from-primary-600 to-accent-500 transition-all duration-300"
                    style={{ width: `${(progress.epoch / progress.totalEpochs) * 100}%` }}
                  />
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 gap-4 text-center">
                  <div>
                    <p className="text-2xl font-bold text-accent-400">
                      {(progress.accuracy * 100).toFixed(1)}%
                    </p>
                    <p className="text-sm text-gray-500">Accuracy</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-gray-300">
                      {progress.loss.toFixed(4)}
                    </p>
                    <p className="text-sm text-gray-500">Loss</p>
                  </div>
                </div>
              </>
            )}

            {!classifierState.isTraining && result && (
              <>
                <div className="text-center mb-6">
                  {result.success ? (
                    <>
                      <svg className="w-16 h-16 mx-auto text-green-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <h2 className="text-xl font-bold text-green-400">Training Complete!</h2>
                    </>
                  ) : (
                    <>
                      <svg className="w-16 h-16 mx-auto text-red-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <h2 className="text-xl font-bold text-red-400">Training Failed</h2>
                      <p className="text-gray-400 mt-2">{result.error}</p>
                    </>
                  )}
                </div>

                {result.success && (
                  <div className="grid grid-cols-2 gap-4 text-center mb-6">
                    <div>
                      <p className="text-2xl font-bold text-accent-400">
                        {(result.finalAccuracy * 100).toFixed(1)}%
                      </p>
                      <p className="text-sm text-gray-500">Final Accuracy</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-gray-300">
                        {result.epochs}
                      </p>
                      <p className="text-sm text-gray-500">Epochs</p>
                    </div>
                  </div>
                )}

                <button
                  onClick={() => setViewState('list')}
                  className="btn-primary w-full"
                >
                  {result.success ? 'Start Detecting' : 'Back to Training'}
                </button>
              </>
            )}

            {!classifierState.isTraining && !result && (
              <div className="text-center py-8">
                <div className="animate-spin w-12 h-12 border-4 border-primary-600 border-t-transparent rounded-full mx-auto mb-4" />
                <p className="text-gray-400">Preparing training data...</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Render Room List (default)
  return (
    <div className="page safe-top">
      {/* Header */}
      <header className="flex items-center gap-4 mb-6">
        <Link to="/" className="btn-ghost p-2">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-xl font-bold">Train Rooms</h1>
      </header>

      <div className="max-w-md mx-auto">
        {/* Add Room Button */}
        <button
          onClick={() => setViewState('add-room')}
          className="btn-primary w-full mb-6"
        >
          <span className="flex items-center justify-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Add New Room
          </span>
        </button>

        {/* Loading State */}
        {roomsState.isLoading && (
          <div className="card text-center py-8">
            <div className="animate-spin w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full mx-auto" />
          </div>
        )}

        {/* Room List */}
        {!roomsState.isLoading && roomsState.rooms.length === 0 ? (
          <div className="card text-center py-12">
            <svg className="w-16 h-16 mx-auto text-gray-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            <h3 className="text-lg font-medium text-gray-300 mb-2">No Rooms Yet</h3>
            <p className="text-gray-500 text-sm">
              Add your first room to start training the acoustic classifier
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {roomsState.rooms.map((room) => (
              <div key={room.id} className="card">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-medium">{room.name}</h3>
                    <p className={`text-sm ${room.sampleCount >= 5 ? 'text-green-400' : 'text-gray-500'}`}>
                      {room.sampleCount} sample{room.sampleCount !== 1 ? 's' : ''}
                      {room.sampleCount < 5 && ` (need ${5 - room.sampleCount} more)`}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDeleteRoom(room.id)}
                    className="btn-ghost p-2 text-gray-500 hover:text-red-400"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
                <button
                  onClick={() => handleStartCapture(room)}
                  className="btn-secondary w-full text-sm"
                >
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                    Capture Samples
                  </span>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Training Section */}
        <div className="mt-8">
          <div className="card">
            <h2 className="section-title">Model Training</h2>
            <p className="text-sm text-gray-500 mb-4">
              {samplesState.trainingMessage}
            </p>

            {/* Orientation Diversity Warning */}
            {allRoomsOrientationWarnings.length > 0 && (
              <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-3 mb-4">
                <div className="flex items-start gap-2">
                  <svg className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div className="text-sm">
                    <p className="text-yellow-400 font-medium mb-1">Low orientation diversity</p>
                    <ul className="text-yellow-300/80 text-xs space-y-1">
                      {allRoomsOrientationWarnings.slice(0, 3).map((warning, i) => (
                        <li key={i}>{warning}</li>
                      ))}
                      {allRoomsOrientationWarnings.length > 3 && (
                        <li>...and {allRoomsOrientationWarnings.length - 3} more</li>
                      )}
                    </ul>
                    <p className="text-yellow-300/60 text-xs mt-2">
                      Try capturing samples while facing different directions for better accuracy.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <button
              onClick={handleTrain}
              className="btn-accent w-full"
              disabled={!samplesState.canTrain || classifierState.isTraining}
            >
              {classifierState.isTraining ? 'Training...' : 'Train Model'}
            </button>

            {classifierState.modelInfo && (
              <p className="text-xs text-center text-gray-500 mt-2">
                Current model: {classifierState.modelInfo.roomCount} rooms, {(classifierState.modelInfo.accuracy * 100).toFixed(0)}% accuracy
              </p>
            )}
          </div>
        </div>

        {/* Tips */}
        <div className="card mt-6">
          <h2 className="section-title">Training Tips</h2>
          <ul className="text-sm text-gray-400 space-y-2">
            <li className="flex gap-2">
              <span className="text-accent-400">•</span>
              Capture samples from different positions in each room
            </li>
            <li className="flex gap-2">
              <span className="text-primary-400">•</span>
              Vary phone orientation (N/E/S/W) for better accuracy
            </li>
            <li className="flex gap-2">
              <span className="text-accent-400">•</span>
              Keep background noise consistent during capture
            </li>
            <li className="flex gap-2">
              <span className="text-accent-400">•</span>
              More samples = better accuracy (10+ recommended)
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
