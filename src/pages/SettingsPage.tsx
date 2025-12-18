import { Link } from 'react-router-dom';
import { useState } from 'react';
import { deleteDatabase } from '../storage';

export default function SettingsPage() {
  const [chirpMode, setChirpMode] = useState<'audible' | 'ultrasonic'>('audible');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);

  const handleClearAllData = async () => {
    if (!clearConfirm) {
      setClearConfirm(true);
      return;
    }

    setIsClearing(true);
    try {
      await deleteDatabase();
      // Reload the page to reset all app state
      window.location.reload();
    } catch (error) {
      console.error('Failed to clear data:', error);
      alert('Failed to clear data. Please try again.');
      setIsClearing(false);
      setClearConfirm(false);
    }
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
        <h1 className="text-xl font-bold">Settings</h1>
      </header>

      <div className="max-w-md mx-auto space-y-6">
        {/* Chirp Settings */}
        <div className="card">
          <h2 className="section-title">Chirp Mode</h2>
          <p className="text-sm text-gray-500 mb-4">
            Choose between accuracy and audibility
          </p>

          <div className="space-y-3">
            <label className={`card cursor-pointer transition-colors ${chirpMode === 'audible' ? 'border-primary-500 bg-primary-600/10' : ''}`}>
              <div className="flex items-start gap-3">
                <input
                  type="radio"
                  name="chirpMode"
                  checked={chirpMode === 'audible'}
                  onChange={() => setChirpMode('audible')}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium">Audible Mode</div>
                  <div className="text-sm text-gray-500">
                    200 Hz - 18 kHz sweep. Higher accuracy, clearly audible.
                  </div>
                </div>
              </div>
            </label>

            <label className={`card cursor-pointer transition-colors ${chirpMode === 'ultrasonic' ? 'border-primary-500 bg-primary-600/10' : ''}`}>
              <div className="flex items-start gap-3">
                <input
                  type="radio"
                  name="chirpMode"
                  checked={chirpMode === 'ultrasonic'}
                  onChange={() => setChirpMode('ultrasonic')}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium">Near-Ultrasonic Mode</div>
                  <div className="text-sm text-gray-500">
                    15 kHz - 20 kHz sweep. Less audible, may have reduced accuracy.
                  </div>
                </div>
              </div>
            </label>
          </div>
        </div>

        {/* Data Management */}
        <div className="card">
          <h2 className="section-title">Data Management</h2>
          <div className="space-y-3">
            <button className="btn-secondary w-full justify-start">
              <span className="flex items-center gap-3">
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Export Training Data
              </span>
            </button>
            <button className="btn-secondary w-full justify-start">
              <span className="flex items-center gap-3">
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Import Training Data
              </span>
            </button>
            <button
              onClick={handleClearAllData}
              onBlur={() => setClearConfirm(false)}
              disabled={isClearing}
              className={`w-full justify-start ${clearConfirm ? 'btn-danger animate-pulse' : 'btn-danger'}`}
            >
              <span className="flex items-center gap-3">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                {isClearing ? 'Clearing...' : clearConfirm ? 'Tap Again to Confirm' : 'Clear All Data'}
              </span>
            </button>
          </div>
        </div>

        {/* Advanced Settings */}
        <div className="card">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center justify-between w-full"
          >
            <h2 className="section-title mb-0">Advanced Settings</h2>
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showAdvanced && (
            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  Chirp Duration (ms)
                </label>
                <input
                  type="number"
                  defaultValue={500}
                  className="input"
                  min={100}
                  max={2000}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  Sample Rate (Hz)
                </label>
                <select className="input" defaultValue={48000}>
                  <option value={44100}>44100</option>
                  <option value={48000}>48000</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  Confidence Threshold
                </label>
                <input
                  type="range"
                  min={0.3}
                  max={0.9}
                  step={0.05}
                  defaultValue={0.6}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>30%</span>
                  <span>60%</span>
                  <span>90%</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* About */}
        <div className="card">
          <h2 className="section-title">About</h2>
          <div className="text-sm text-gray-400 space-y-2">
            <p><span className="text-gray-300">Version:</span> 0.1.0 (Prototype)</p>
            <p><span className="text-gray-300">Storage:</span> Local only (IndexedDB)</p>
            <p className="pt-2">
              EchoRoom uses acoustic fingerprinting to identify rooms based on their unique sound characteristics.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
