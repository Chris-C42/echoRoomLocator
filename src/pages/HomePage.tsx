import { Link } from 'react-router-dom';
import { useRooms, useRoomClassifier } from '../hooks';

export default function HomePage() {
  const { state: roomsState } = useRooms();
  const { state: classifierState } = useRoomClassifier();

  const roomCount = roomsState.rooms.length;
  const totalSamples = roomsState.rooms.reduce((sum, r) => sum + r.sampleCount, 0);
  const hasModel = classifierState.modelState === 'ready';
  const accuracy = classifierState.modelInfo?.accuracy;

  return (
    <div className="page safe-top">
      <header className="text-center mb-8 pt-8">
        <h1 className="text-3xl font-bold gradient-text mb-2">EchoRoom</h1>
        <p className="text-gray-400">Acoustic Room Detection</p>
      </header>

      <div className="max-w-md mx-auto space-y-4">
        {/* Status Card */}
        <div className="card">
          <h2 className="section-title">Status</h2>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold text-primary-400">{roomCount}</p>
              <p className="text-sm text-gray-500">Rooms</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-primary-400">{totalSamples}</p>
              <p className="text-sm text-gray-500">Samples</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-accent-400">
                {hasModel && accuracy ? `${(accuracy * 100).toFixed(0)}%` : '--'}
              </p>
              <p className="text-sm text-gray-500">Accuracy</p>
            </div>
          </div>

          {/* Model Status Badge */}
          <div className="mt-4 pt-4 border-t border-dark-600">
            <div className="flex items-center justify-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  hasModel ? 'bg-accent-500' : 'bg-gray-500'
                }`}
              />
              <span className="text-sm text-gray-400">
                {hasModel
                  ? `Model trained (${classifierState.modelInfo?.roomCount} rooms)`
                  : 'No model trained'}
              </span>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="space-y-3">
          <Link to="/detection" className="block">
            <button
              className={`w-full text-lg py-4 ${
                hasModel
                  ? 'btn-primary glow-primary'
                  : 'btn-secondary opacity-75'
              }`}
            >
              <span className="flex items-center justify-center gap-2">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
                Detect Room
              </span>
            </button>
          </Link>

          <Link to="/training" className="block">
            <button className="btn-secondary w-full">
              <span className="flex items-center justify-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                Train Rooms
              </span>
            </button>
          </Link>

          <Link to="/settings" className="block">
            <button className="btn-ghost w-full">
              <span className="flex items-center justify-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Settings
              </span>
            </button>
          </Link>
        </div>

        {/* How it works */}
        <div className="card mt-8">
          <h2 className="section-title">How It Works</h2>
          <ol className="space-y-3 text-sm text-gray-400">
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary-600 text-white flex items-center justify-center text-xs">1</span>
              <span>Train rooms by capturing audio samples in each location</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary-600 text-white flex items-center justify-center text-xs">2</span>
              <span>The app emits a chirp and analyzes the acoustic response</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary-600 text-white flex items-center justify-center text-xs">3</span>
              <span>Machine learning identifies which room you're in</span>
            </li>
          </ol>
        </div>
      </div>

      {/* Version info */}
      <p className="text-center text-gray-600 text-xs mt-8">
        EchoRoom v0.1.0 - Prototype
      </p>
    </div>
  );
}
