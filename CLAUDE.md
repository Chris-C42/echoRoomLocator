# CLAUDE.md - Instructions for Claude Code

## Project Overview

**EchoRoom** is a PWA that uses acoustic fingerprinting for indoor room detection. The user emits a chirp sound, captures the room's acoustic response, extracts features, and trains an ML classifier to recognize which room they're in.

---

## Quick Reference

```bash
# Development
npm install          # Install dependencies
npm run dev          # Start dev server (Vite)
npm run build        # Production build
npm run preview      # Preview production build
npm run test         # Run tests

# Type checking
npm run typecheck    # TypeScript type check
```

---

## Tech Stack

- **Framework:** React 18 with TypeScript
- **Build Tool:** Vite
- **Styling:** Tailwind CSS
- **Audio:** Web Audio API (native)
- **ML:** TensorFlow.js
- **Storage:** IndexedDB via idb
- **Testing:** Vitest + React Testing Library
- **PWA:** vite-plugin-pwa

---

## Architecture Guidelines

### Module Responsibilities

```
src/audio/     → All Web Audio API interactions, signal processing
src/ml/        → TensorFlow.js model, training, inference
src/storage/   → IndexedDB operations, data persistence
src/hooks/     → React hooks wrapping the above modules
src/components/→ UI components (pure presentation where possible)
src/pages/     → Page-level components with routing
```

### Key Design Principles

1. **Separation of concerns**: Audio processing, ML, and UI are independent modules
2. **Hooks as glue**: React hooks connect modules to components
3. **Offline-first**: All core functionality works without network
4. **Progressive enhancement**: Basic features work everywhere, advanced features where supported

---

## Implementation Guidelines

### Audio Processing

**ChirpGenerator.ts**
```typescript
// Generate a logarithmic sine sweep
// Key formula: f(t) = f_start * (f_end / f_start)^(t/T)

interface ChirpConfig {
  startFrequency: number;   // Default: 200 Hz
  endFrequency: number;     // Default: 18000 Hz
  duration: number;         // Default: 0.5 seconds
  sampleRate: number;       // Default: 48000
}

// The chirp should have smooth fade-in/out to prevent clicks
// Use Hann window or linear fade of ~10ms at each end
```

**AudioCapture.ts**
```typescript
// Use getUserMedia for microphone access
// Use AudioContext + MediaStreamAudioSourceNode
// Buffer captured audio to Float32Array

// IMPORTANT: iOS Safari requires audio context to be created/resumed
// after a user gesture. Handle this in the capture flow.
```

**ImpulseResponseExtractor.ts**
```typescript
// Deconvolution via frequency domain division
// H(f) = Y(f) * conj(X(f)) / (|X(f)|² + ε)
// where ε is regularization (e.g., 0.001) to prevent division by zero

// Use a power-of-2 FFT size, zero-pad inputs as needed
```

**FeatureExtractor.ts**
```typescript
// Extract these features from the impulse response:
// 1. RT60 (reverberation time) - via Schroeder integration
// 2. EDT (early decay time)
// 3. C50, C80 (clarity ratios)
// 4. Spectral features (centroid, rolloff, flux)
// 5. MFCC (13 coefficients, mean and variance)
// 6. Early reflection energy (8 time bins, 0-80ms)
// 7. Octave band energy (125Hz to 8kHz)

// Total feature vector: ~60 values
```

### Machine Learning

**RoomClassifier.ts**
```typescript
// MLP architecture:
// Input: 60 features (normalized)
// Hidden 1: 128 units, ReLU, Dropout(0.3)
// Hidden 2: 64 units, ReLU, Dropout(0.2)
// Hidden 3: 32 units, ReLU
// Output: N classes, Softmax

// Use tf.sequential() or tf.model()
// Adam optimizer, categorical crossentropy loss
```

**Training considerations:**
- Minimum 5 samples per room, recommend 10+
- Use 20% validation split
- Early stopping with patience=10
- Apply class weights for imbalanced classes
- Data augmentation: add small Gaussian noise to features

**Confidence estimation:**
- Primary: Softmax probability of top class
- Secondary: Entropy of probability distribution
- Flag low confidence when: top probability < 0.6 or entropy > 1.0

### Storage Schema

**IndexedDB Database: 'echoroom-db'**

```typescript
// Object stores:

// 'rooms' store
interface Room {
  id: string;           // UUID
  name: string;
  icon?: string;        // Emoji or icon name
  color?: string;       // Hex color
  createdAt: number;    // Timestamp
  updatedAt: number;    // Timestamp
}

// 'samples' store (indexed by roomId)
interface Sample {
  id: string;           // UUID
  roomId: string;       // Foreign key to rooms
  features: number[];   // Feature vector
  capturedAt: number;   // Timestamp
}

// 'model' store (single record)
interface StoredModel {
  id: 'current';        // Fixed key
  topology: object;     // Model JSON
  weights: ArrayBuffer; // Serialized weights
  roomLabels: string[]; // Room ID to class index mapping
  normalizer: {         // Feature normalization params
    mean: number[];
    std: number[];
  };
  createdAt: number;
  accuracy: number;     // Final training accuracy
}
```

### Component Guidelines

**Visualizations**
- Use Canvas API for waveforms and spectrograms (performance)
- Use SVG for static charts (radar, confidence meters)
- Implement resize observers for responsive canvas

**Training Flow**
1. User selects or creates room
2. Tap to capture → play chirp → record response → extract features
3. Show captured sample with visualization
4. User confirms or discards
5. After sufficient samples, enable "Train Model" button
6. Training shows real-time progress (epoch, loss, accuracy)

**Detection Flow**
1. User taps "Detect" or continuous mode
2. Emit chirp, capture, extract features
3. Run inference
4. Display result with confidence
5. Optionally show alternatives and let user correct

### Error Handling

```typescript
// Audio permission errors
try {
  await navigator.mediaDevices.getUserMedia({ audio: true });
} catch (error) {
  if (error.name === 'NotAllowedError') {
    // Show permission denied UI
  } else if (error.name === 'NotFoundError') {
    // No microphone available
  }
}

// Handle AudioContext restrictions (iOS Safari)
if (audioContext.state === 'suspended') {
  await audioContext.resume();
}

// TensorFlow.js errors
try {
  await model.fit(...);
} catch (error) {
  if (error.message.includes('memory')) {
    // Handle OOM - reduce batch size
  }
}
```

---

## Testing Approach

### Unit Tests (Vitest)

```typescript
// Audio tests - verify signal processing math
describe('ChirpGenerator', () => {
  it('should generate sweep from startFreq to endFreq');
  it('should have correct duration in samples');
  it('should have smooth envelope (no clicks)');
});

describe('FeatureExtractor', () => {
  it('should extract RT60 within expected range');
  it('should produce consistent features for same input');
  it('should return vector of correct length');
});
```

### Integration Tests

```typescript
// Full pipeline tests
describe('Training Pipeline', () => {
  it('should capture audio and extract features');
  it('should store samples in IndexedDB');
  it('should train model with stored samples');
  it('should persist model across sessions');
});
```

### Manual Testing Checklist

When testing audio features:
- [ ] Test with headphones (no echo)
- [ ] Test with phone speaker (normal use case)
- [ ] Test in quiet room
- [ ] Test with background noise
- [ ] Test on iOS Safari (permission flow differs)
- [ ] Test on Android Chrome

---

## Common Pitfalls to Avoid

### Audio

❌ **Don't** create multiple AudioContext instances
✅ **Do** reuse a single AudioContext, resume when needed

❌ **Don't** assume microphone permission is granted
✅ **Do** always handle permission denial gracefully

❌ **Don't** use synchronous audio processing in main thread
✅ **Do** use AudioWorklet for real-time processing when needed

### ML

❌ **Don't** train with unnormalized features
✅ **Do** apply z-score normalization, store normalizer params

❌ **Don't** ignore class imbalance
✅ **Do** use class weights or oversampling

❌ **Don't** trust high training accuracy alone
✅ **Do** use validation set and cross-validation

### Storage

❌ **Don't** store raw audio (too large)
✅ **Do** store only extracted features

❌ **Don't** block UI during IndexedDB operations
✅ **Do** use async/await, show loading states

### PWA

❌ **Don't** cache everything indefinitely
✅ **Do** version caches, handle updates gracefully

❌ **Don't** assume service worker is active immediately
✅ **Do** handle the "waiting" state, prompt for refresh

---

## File-by-File Implementation Order

### Phase 1: Foundation
1. `package.json` - Dependencies and scripts
2. `vite.config.ts` - Build configuration
3. `tsconfig.json` - TypeScript config
4. `tailwind.config.js` - Tailwind setup
5. `src/main.tsx` - App entry
6. `src/App.tsx` - Router setup

### Phase 2: Audio Engine
1. `src/audio/types.ts` - Type definitions
2. `src/audio/utils.ts` - Math helpers (FFT, etc.)
3. `src/audio/ChirpGenerator.ts`
4. `src/audio/AudioCapture.ts`
5. `src/audio/ImpulseResponseExtractor.ts`
6. `src/audio/FeatureExtractor.ts`
7. `src/audio/index.ts` - Public API

### Phase 3: Storage
1. `src/storage/database.ts` - IndexedDB setup
2. `src/storage/RoomStore.ts`
3. `src/storage/SampleStore.ts`
4. `src/storage/ModelStore.ts`
5. `src/storage/index.ts`

### Phase 4: ML Engine
1. `src/ml/types.ts`
2. `src/ml/FeatureNormalizer.ts`
3. `src/ml/RoomClassifier.ts`
4. `src/ml/ModelTrainer.ts`
5. `src/ml/ConfidenceEstimator.ts`
6. `src/ml/index.ts`

### Phase 5: Hooks
1. `src/hooks/useAudioEngine.ts`
2. `src/hooks/useRooms.ts`
3. `src/hooks/useSamples.ts`
4. `src/hooks/useRoomClassifier.ts`

### Phase 6: UI Components
1. `src/components/common/*` - Reusable UI
2. `src/components/visualizations/*` - Charts/graphs
3. `src/components/training/*` - Training flow
4. `src/components/detection/*` - Detection UI
5. `src/components/layout/*` - App shell

### Phase 7: Pages
1. `src/pages/HomePage.tsx`
2. `src/pages/TrainingPage.tsx`
3. `src/pages/DetectionPage.tsx`
4. `src/pages/SettingsPage.tsx`

### Phase 8: PWA
1. `public/manifest.json`
2. `public/sw.js` (or via vite-plugin-pwa)
3. Icons and assets

---

## Key Dependencies

```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.x",
    "@tensorflow/tfjs": "^4.x",
    "idb": "^7.x",
    "uuid": "^9.x"
  },
  "devDependencies": {
    "@types/react": "^18.x",
    "@types/react-dom": "^18.x",
    "typescript": "^5.x",
    "vite": "^5.x",
    "@vitejs/plugin-react": "^4.x",
    "tailwindcss": "^3.x",
    "autoprefixer": "^10.x",
    "postcss": "^8.x",
    "vitest": "^1.x",
    "@testing-library/react": "^14.x",
    "vite-plugin-pwa": "^0.17.x"
  }
}
```

---

## DSP Reference Implementations

### FFT (use existing library or implement)

```typescript
// Recommend using a library like 'fft.js' or implement Cooley-Tukey
// For deconvolution, need both forward and inverse FFT
// Ensure power-of-2 sizes, zero-pad as needed
```

### MFCC Computation

```typescript
function computeMFCC(signal: Float32Array, sampleRate: number): number[] {
  // 1. Frame signal with ~25ms windows, ~10ms hop
  // 2. Apply Hann window
  // 3. Compute power spectrum via FFT
  // 4. Apply mel filterbank (26-40 filters)
  // 5. Log compress energies
  // 6. Apply DCT, keep coefficients 1-13
  return mfccs;
}
```

### RT60 Estimation

```typescript
function estimateRT60(ir: Float32Array, sampleRate: number): number {
  // 1. Compute squared IR
  // 2. Backwards integration (Schroeder)
  // 3. Convert to dB
  // 4. Find -5dB and -35dB points
  // 5. Linear regression on that segment
  // 6. Extrapolate to -60dB
  return rt60InSeconds;
}
```

---

## Performance Targets

- Chirp generation: < 10ms
- Audio capture: Real-time (sample rate dependent)
- Feature extraction: < 100ms
- Model inference: < 50ms
- Full detection cycle: < 2 seconds (including chirp playback)

---

## Accessibility Requirements

- All interactive elements keyboard accessible
- Screen reader announcements for detection results
- High contrast mode support
- Reduced motion option (disable waveform animations)
- Touch targets minimum 44x44px

---

## Questions to Clarify with User

Before implementing advanced features, clarify:

1. **Target devices**: Primarily mobile? Also desktop?
2. **Number of rooms**: Typical use case - 3-5 rooms? More?
3. **Continuous detection**: Auto-detect in background, or manual only?
4. **Privacy concerns**: Any need for cloud sync, or strictly local?
5. **Chirp audibility**: Acceptable to hear the chirp, or prefer near-ultrasonic?

---

## Debugging Tips

### Audio Issues
```typescript
// Log audio context state
console.log('AudioContext state:', audioContext.state);
console.log('Sample rate:', audioContext.sampleRate);

// Visualize captured audio
// Plot waveform to verify capture is working
```

### Feature Issues
```typescript
// Log feature ranges to catch normalization issues
console.log('RT60:', features.rt60, 'expected: 0.2-2.0s');
console.log('Spectral centroid:', features.spectralCentroid, 'expected: 500-5000Hz');
```

### ML Issues
```typescript
// Log training progress
model.fit(x, y, {
  callbacks: {
    onEpochEnd: (epoch, logs) => {
      console.log(`Epoch ${epoch}: loss=${logs.loss}, acc=${logs.acc}`);
    }
  }
});

// Check for NaN in predictions
const pred = model.predict(input);
if (pred.dataSync().some(isNaN)) {
  console.error('NaN in predictions - check feature normalization');
}
```

---

*Last updated: Auto-generated for Claude Code handoff*
