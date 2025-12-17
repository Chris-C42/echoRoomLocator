# Indoor Location Classifier - Technical Plan

## Project Overview

**EchoRoom** is a Progressive Web App that uses acoustic fingerprinting to determine which room a user is in within their home. It leverages the Web Audio API to emit audio chirps, capture room responses, and train a machine learning classifier to recognize distinct acoustic signatures of different rooms.

---

## Table of Contents

1. [Core Concept & Theory](#1-core-concept--theory)
2. [Technical Architecture](#2-technical-architecture)
3. [Feature Extraction Pipeline](#3-feature-extraction-pipeline)
4. [Machine Learning Approach](#4-machine-learning-approach)
5. [User Interface Design](#5-user-interface-design)
6. [PWA Requirements](#6-pwa-requirements)
7. [Implementation Phases](#7-implementation-phases)
8. [File Structure](#8-file-structure)
9. [API Specifications](#9-api-specifications)
10. [Testing Strategy](#10-testing-strategy)
11. [Known Limitations & Mitigations](#11-known-limitations--mitigations)

---

## 1. Core Concept & Theory

### 1.1 Acoustic Room Fingerprinting

Every room has a unique acoustic signature determined by:

- **Dimensions**: Length, width, height affect resonant frequencies and reflection timing
- **Materials**: Hard surfaces (tile, glass) reflect sound; soft surfaces (carpet, curtains) absorb it
- **Contents**: Furniture, objects create diffraction and scattering patterns
- **Openings**: Doors, windows, hallways affect how sound escapes

### 1.2 Room Impulse Response (RIR)

When a sound is emitted in a room, the microphone captures:

```
Time →
│
│ ▌           Direct sound (travels straight from speaker to mic)
│ ▌
│ ▌  ▌▌ ▌     Early reflections (first bounces off walls, 5-80ms)
│ ▌  ▌▌▌▌▌▌
│ ▌▌▌▌▌▌▌▌▌▌▄▄▄▃▃▃▂▂▂▁▁▁   Late reverb / diffuse tail (80ms+)
└────────────────────────────────
  0ms        50ms       200ms
```

The shape of this response encodes the room's acoustic properties.

### 1.3 Chirp-Based Measurement

Rather than using impulse sounds (clicks), we use **logarithmic sine sweeps** (chirps):

**Advantages:**
- Better signal-to-noise ratio
- Spreads energy across time (louder without distortion)
- Allows precise impulse response extraction via deconvolution
- Can use near-ultrasonic frequencies to reduce audibility

**Chirp Specification:**
- Start frequency: 200 Hz (captures room modes)
- End frequency: 18,000 Hz (near limit of most speakers/mics)
- Duration: 0.5 - 1.0 seconds
- Amplitude envelope: Fade in/out to prevent clicks

### 1.4 Key Acoustic Features

| Feature | What It Measures | Discriminative Power |
|---------|------------------|---------------------|
| RT60 | Time for sound to decay 60dB | Room size, absorption |
| EDT | Early Decay Time | Perception of reverb |
| C50/C80 | Clarity ratios | Direct vs reverb balance |
| Early Reflection Pattern | First 50-80ms of RIR | Room geometry |
| Spectral Centroid | "Brightness" of reverb | Material properties |
| MFCC | Mel-frequency cepstral coefficients | General audio features |
| Energy Decay Curve | dB over time | Room damping |

---

## 2. Technical Architecture

### 2.1 High-Level System Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              EchoRoom PWA                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                │
│  │   UI Layer  │    │ Audio Engine│    │  ML Engine  │                │
│  │   (React)   │◄──►│ (Web Audio) │◄──►│(TensorFlow) │                │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘                │
│         │                  │                  │                        │
│         ▼                  ▼                  ▼                        │
│  ┌─────────────────────────────────────────────────────┐              │
│  │                   State Management                   │              │
│  │                  (React Context/Zustand)             │              │
│  └─────────────────────────┬───────────────────────────┘              │
│                            │                                           │
│                            ▼                                           │
│  ┌─────────────────────────────────────────────────────┐              │
│  │                   IndexedDB Storage                  │              │
│  │  - Room configurations                               │              │
│  │  - Training samples (compressed)                     │              │
│  │  - Trained model weights                             │              │
│  └─────────────────────────────────────────────────────┘              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Core Modules

#### AudioEngine (`/src/audio/`)
- `ChirpGenerator.ts` - Creates logarithmic sine sweep signals
- `AudioCapture.ts` - Manages microphone input stream
- `ImpulseResponseExtractor.ts` - Deconvolves captured audio to get RIR
- `FeatureExtractor.ts` - Computes acoustic features from RIR
- `AudioWorkletProcessors/` - Real-time audio processing

#### MLEngine (`/src/ml/`)
- `FeatureNormalizer.ts` - Standardizes features for ML input
- `RoomClassifier.ts` - TensorFlow.js model wrapper
- `ModelTrainer.ts` - Handles training loop and validation
- `ConfidenceEstimator.ts` - Produces confidence intervals

#### Storage (`/src/storage/`)
- `RoomStore.ts` - CRUD operations for room configurations
- `SampleStore.ts` - Manages training samples
- `ModelStore.ts` - Saves/loads trained models

#### UI Components (`/src/components/`)
- `RoomManager/` - Add, edit, delete rooms
- `TrainingMode/` - Capture training samples
- `DetectionMode/` - Real-time room detection
- `Visualizations/` - Waveforms, spectrograms, confidence displays
- `Settings/` - App configuration

---

## 3. Feature Extraction Pipeline

### 3.1 Signal Flow

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  Chirp   │───►│  Capture │───►│Deconvolve│───►│ Extract  │
│Generator │    │ Response │    │  to RIR  │    │ Features │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
     │                                               │
     │         ┌──────────────────────────┐         │
     └────────►│   Reference Chirp Buffer │─────────┘
               └──────────────────────────┘
```

### 3.2 Chirp Generation (Logarithmic Sweep)

```javascript
// Frequency at time t for log sweep
f(t) = f_start * (f_end / f_start) ^ (t / T)

// Phase integral for continuous sweep
φ(t) = 2π * f_start * T / ln(f_end/f_start) * ((f_end/f_start)^(t/T) - 1)

// Signal
x(t) = A * sin(φ(t)) * envelope(t)
```

### 3.3 Impulse Response Extraction

The captured signal `y(t)` is the convolution of the chirp `x(t)` with the room impulse response `h(t)`:

```
y(t) = x(t) * h(t)
```

To extract `h(t)`, we use deconvolution in the frequency domain:

```
H(f) = Y(f) / X(f)
h(t) = IFFT(H(f))
```

In practice, we use regularized deconvolution to handle noise:

```
H(f) = Y(f) * conj(X(f)) / (|X(f)|² + ε)
```

### 3.4 Feature Computation

**RT60 Estimation:**
1. Compute energy decay curve: `EDC(t) = ∫[t,∞] h²(τ) dτ`
2. Convert to dB: `EDC_dB(t) = 10 * log10(EDC(t))`
3. Linear regression on -5dB to -35dB portion
4. Extrapolate to -60dB

**MFCC Extraction:**
1. Frame the RIR into overlapping windows
2. Compute power spectrum via FFT
3. Apply mel filterbank
4. Take log of filterbank energies
5. Apply DCT, keep coefficients 1-13

**Spectral Features:**
- Centroid: `Σ(f * |X(f)|) / Σ|X(f)|`
- Rolloff: Frequency below which 85% of energy exists
- Flux: Frame-to-frame spectral change

### 3.5 Feature Vector Structure

```typescript
interface RoomFeatureVector {
  // Temporal features
  rt60: number;              // Reverberation time (ms)
  edt: number;               // Early decay time (ms)
  c50: number;               // Clarity ratio (dB)
  c80: number;               // Clarity ratio (dB)
  
  // Spectral features
  spectralCentroid: number;  // Hz
  spectralRolloff: number;   // Hz
  spectralFlux: number;      // Normalized
  
  // Early reflections (first 80ms, 8 time bins)
  earlyReflectionEnergy: number[8];
  
  // MFCC (13 coefficients, mean and variance)
  mfccMean: number[13];
  mfccVar: number[13];
  
  // Frequency band energy (octave bands)
  bandEnergy: number[8];     // 125Hz to 8kHz
  
  // Total: ~60 features
}
```

---

## 4. Machine Learning Approach

### 4.1 Model Architecture

**Primary Model: Multi-Layer Perceptron**

```
Input Layer (60 features)
        │
        ▼
Dense Layer (128 units, ReLU, Dropout 0.3)
        │
        ▼
Dense Layer (64 units, ReLU, Dropout 0.2)
        │
        ▼
Dense Layer (32 units, ReLU)
        │
        ▼
Output Layer (N rooms, Softmax)
```

**Why MLP over CNN/RNN:**
- Feature vector is pre-computed, not raw audio
- Small dataset (5-20 samples per room)
- Fast inference for real-time detection
- Easy to train in-browser

### 4.2 Training Strategy

**Data Augmentation:**
- Add Gaussian noise to features (σ = 0.05)
- Time-stretch simulation (±5% on temporal features)
- Dropout-style feature masking

**Training Configuration:**
```typescript
const trainingConfig = {
  optimizer: 'adam',
  learningRate: 0.001,
  batchSize: 16,
  epochs: 100,
  validationSplit: 0.2,
  earlyStopping: {
    patience: 10,
    minDelta: 0.001
  },
  classWeights: 'balanced'  // Handle class imbalance
};
```

**Minimum Training Data:**
- 5 samples per room (minimum viable)
- 10+ samples per room (recommended)
- Samples should be taken at different positions within each room

### 4.3 Confidence Estimation

We provide confidence intervals using multiple approaches:

1. **Softmax Probability**: Direct output probability
2. **Entropy**: `H = -Σ p_i * log(p_i)` (lower = more confident)
3. **MC Dropout**: Run inference multiple times with dropout, measure variance
4. **Calibration**: Temperature scaling post-training for better-calibrated probabilities

**Confidence Thresholds:**
- High confidence: >80% probability, entropy <0.5
- Medium confidence: 50-80% probability
- Low confidence: <50%, suggest retraining

### 4.4 Continuous Learning

The app supports ongoing training:

1. **Explicit retraining**: User manually captures new samples
2. **Soft labeling**: When confident prediction is confirmed by user behavior
3. **Anomaly detection**: Flag when environment seems different (new furniture, etc.)

---

## 5. User Interface Design

### 5.1 App Screens

```
┌─────────────────────────────────────────────┐
│              EchoRoom                       │
├─────────────────────────────────────────────┤
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │        CURRENT LOCATION             │   │
│  │                                     │   │
│  │         🛋️ Living Room              │   │
│  │                                     │   │
│  │         Confidence: 87%             │   │
│  │         ████████████░░░             │   │
│  │                                     │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │  Alternative possibilities:         │   │
│  │  • Kitchen: 8%                      │   │
│  │  • Bedroom: 5%                      │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  [🔊 Test Detection]  [📊 View Details]    │
│                                             │
├─────────────────────────────────────────────┤
│  🏠 Home    📚 Train    ⚙️ Settings         │
└─────────────────────────────────────────────┘
```

### 5.2 Training Flow

```
Step 1: Select/Create Room
┌─────────────────────────────────────────────┐
│  Select Room to Train                       │
│                                             │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ │
│  │ Living    │ │ Kitchen   │ │ Bedroom   │ │
│  │ Room      │ │           │ │           │ │
│  │ 8 samples │ │ 5 samples │ │ 3 samples │ │
│  └───────────┘ └───────────┘ └───────────┘ │
│                                             │
│  [+ Add New Room]                           │
└─────────────────────────────────────────────┘

Step 2: Capture Sample
┌─────────────────────────────────────────────┐
│  Training: Living Room                      │
│                                             │
│  Hold your phone steady and tap to capture  │
│  an acoustic sample.                        │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │                                     │   │
│  │          [🎤 Capture]               │   │
│  │                                     │   │
│  │   ~~~~ Waveform Visualization ~~~   │   │
│  │                                     │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  Samples collected: 8                       │
│  Recommended: 10                            │
│                                             │
│  [Done Training Room]                       │
└─────────────────────────────────────────────┘

Step 3: Review & Train Model
┌─────────────────────────────────────────────┐
│  Training Summary                           │
│                                             │
│  Rooms: 4                                   │
│  Total samples: 38                          │
│                                             │
│  • Living Room: 10 samples ✓               │
│  • Kitchen: 10 samples ✓                   │
│  • Bedroom: 10 samples ✓                   │
│  • Bathroom: 8 samples ⚠️                  │
│                                             │
│  [Train Model]                              │
│                                             │
│  Training progress:                         │
│  ████████████████░░░░ 80%                  │
│  Epoch 80/100 - Accuracy: 94%              │
└─────────────────────────────────────────────┘
```

### 5.3 Visualizations

**Real-time Waveform:**
- Shows captured audio during recording
- Helps user verify audio is being captured

**Impulse Response Display:**
- Time-domain RIR plot
- Highlights early reflections vs late reverb

**Spectrogram:**
- Frequency content over time
- Useful for debugging and understanding room acoustics

**Feature Radar Chart:**
- Normalized feature values in radar/spider chart
- Visual comparison between rooms

**Confidence History:**
- Line chart of detection confidence over time
- Helps identify unstable detections

---

## 6. PWA Requirements

### 6.1 Service Worker Strategy

**Caching Strategy:**
- App shell: Cache-first (HTML, CSS, JS, assets)
- API calls: Network-first with cache fallback
- Audio worklet scripts: Cache-first
- ML model: Cache-first, background update check

```javascript
// Cache versions
const CACHE_NAME = 'echoroom-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/static/js/main.js',
  '/static/css/main.css',
  '/worklets/audio-processor.js',
  '/models/room-classifier.json'
];
```

### 6.2 Manifest Configuration

```json
{
  "name": "EchoRoom - Indoor Location",
  "short_name": "EchoRoom",
  "description": "Detect your room using acoustic fingerprinting",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#1a1a2e",
  "theme_color": "#4a90d9",
  "orientation": "portrait",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ],
  "permissions": [
    "microphone"
  ]
}
```

### 6.3 Required Permissions

| Permission | Purpose | Request Timing |
|------------|---------|----------------|
| Microphone | Capture room response | On first training attempt |
| Storage | IndexedDB for samples/model | Automatic |
| Background Sync | Continuous detection (optional) | User opt-in |

### 6.4 Browser Compatibility

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| Web Audio API | ✅ | ✅ | ✅ | ✅ |
| AudioWorklet | ✅ | ✅ | ✅ | ✅ |
| getUserMedia | ✅ | ✅ | ✅ | ✅ |
| IndexedDB | ✅ | ✅ | ✅ | ✅ |
| TensorFlow.js | ✅ | ✅ | ✅ | ✅ |
| Service Worker | ✅ | ✅ | ✅ | ✅ |

**Notes:**
- iOS Safari requires user gesture to start audio context
- Some older devices may have limited frequency response
- WebGL backend for TF.js may not be available on all devices

---

## 7. Implementation Phases

### Phase 1: Audio Foundation (Week 1-2)

**Goals:**
- [ ] Set up React + TypeScript + Vite project
- [ ] Implement chirp generation with Web Audio API
- [ ] Implement audio capture with getUserMedia
- [ ] Basic waveform visualization
- [ ] Test on multiple devices

**Deliverables:**
- Working audio engine that can emit chirp and capture response
- Visual feedback showing captured audio

### Phase 2: Signal Processing (Week 2-3)

**Goals:**
- [ ] Implement deconvolution for RIR extraction
- [ ] Implement feature extraction pipeline
- [ ] Add spectrogram visualization
- [ ] Impulse response visualization
- [ ] Validate features against known room acoustics

**Deliverables:**
- Feature extraction producing consistent vectors
- Visualizations for debugging and user feedback

### Phase 3: Machine Learning (Week 3-4)

**Goals:**
- [ ] Set up TensorFlow.js
- [ ] Implement classifier architecture
- [ ] Training pipeline with progress feedback
- [ ] Model serialization to IndexedDB
- [ ] Confidence estimation

**Deliverables:**
- Trainable classifier that persists across sessions
- Accuracy metrics display during training

### Phase 4: Training UI (Week 4-5)

**Goals:**
- [ ] Room management interface
- [ ] Sample capture flow
- [ ] Training progress display
- [ ] Sample review/deletion
- [ ] Data export/import

**Deliverables:**
- Complete training workflow
- User can create rooms and capture samples

### Phase 5: Detection UI (Week 5-6)

**Goals:**
- [ ] Real-time detection mode
- [ ] Confidence display
- [ ] Detection history
- [ ] Manual correction feedback
- [ ] Notification of low confidence

**Deliverables:**
- Working room detection with confidence intervals

### Phase 6: PWA & Polish (Week 6-7)

**Goals:**
- [ ] Service worker implementation
- [ ] Offline functionality
- [ ] Install prompts
- [ ] Performance optimization
- [ ] Accessibility audit
- [ ] Cross-device testing

**Deliverables:**
- Installable PWA with offline support

### Phase 7: Advanced Features (Week 7-8)

**Goals:**
- [ ] Continuous learning mode
- [ ] Background detection (where supported)
- [ ] Room similarity analysis
- [ ] Troubleshooting guide
- [ ] Analytics (opt-in)

**Deliverables:**
- Production-ready application

---

## 8. File Structure

```
IndoorLocationClassifier/
├── PLAN.md                     # This document
├── CLAUDE.md                   # Instructions for Claude Code
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── public/
│   ├── manifest.json
│   ├── sw.js                   # Service worker
│   ├── icons/
│   │   ├── icon-192.png
│   │   └── icon-512.png
│   └── worklets/
│       └── audio-processor.js  # AudioWorklet processor
├── src/
│   ├── main.tsx                # App entry point
│   ├── App.tsx                 # Root component
│   ├── index.css               # Global styles
│   ├── vite-env.d.ts
│   │
│   ├── audio/                  # Audio processing module
│   │   ├── index.ts
│   │   ├── ChirpGenerator.ts
│   │   ├── AudioCapture.ts
│   │   ├── ImpulseResponseExtractor.ts
│   │   ├── FeatureExtractor.ts
│   │   ├── types.ts
│   │   └── utils.ts
│   │
│   ├── ml/                     # Machine learning module
│   │   ├── index.ts
│   │   ├── RoomClassifier.ts
│   │   ├── ModelTrainer.ts
│   │   ├── FeatureNormalizer.ts
│   │   ├── ConfidenceEstimator.ts
│   │   └── types.ts
│   │
│   ├── storage/                # Data persistence
│   │   ├── index.ts
│   │   ├── database.ts         # IndexedDB setup
│   │   ├── RoomStore.ts
│   │   ├── SampleStore.ts
│   │   └── ModelStore.ts
│   │
│   ├── hooks/                  # React hooks
│   │   ├── useAudioEngine.ts
│   │   ├── useRoomClassifier.ts
│   │   ├── useRooms.ts
│   │   └── useSamples.ts
│   │
│   ├── context/                # React context
│   │   ├── AppContext.tsx
│   │   └── AudioContext.tsx
│   │
│   ├── components/             # UI components
│   │   ├── common/
│   │   │   ├── Button.tsx
│   │   │   ├── Card.tsx
│   │   │   ├── ProgressBar.tsx
│   │   │   ├── Modal.tsx
│   │   │   └── Icon.tsx
│   │   │
│   │   ├── layout/
│   │   │   ├── Header.tsx
│   │   │   ├── Navigation.tsx
│   │   │   └── Layout.tsx
│   │   │
│   │   ├── visualizations/
│   │   │   ├── Waveform.tsx
│   │   │   ├── Spectrogram.tsx
│   │   │   ├── ImpulseResponse.tsx
│   │   │   ├── FeatureRadar.tsx
│   │   │   └── ConfidenceChart.tsx
│   │   │
│   │   ├── training/
│   │   │   ├── RoomSelector.tsx
│   │   │   ├── SampleCapture.tsx
│   │   │   ├── TrainingProgress.tsx
│   │   │   └── SampleReview.tsx
│   │   │
│   │   └── detection/
│   │       ├── DetectionDisplay.tsx
│   │       ├── ConfidenceMeter.tsx
│   │       └── DetectionHistory.tsx
│   │
│   ├── pages/                  # Page components
│   │   ├── HomePage.tsx
│   │   ├── TrainingPage.tsx
│   │   ├── DetectionPage.tsx
│   │   └── SettingsPage.tsx
│   │
│   ├── utils/                  # Utility functions
│   │   ├── math.ts             # DSP math utilities
│   │   ├── fft.ts              # FFT implementation
│   │   └── helpers.ts
│   │
│   └── types/                  # TypeScript types
│       ├── audio.ts
│       ├── ml.ts
│       ├── room.ts
│       └── index.ts
│
└── tests/                      # Test files
    ├── audio/
    │   └── ChirpGenerator.test.ts
    ├── ml/
    │   └── RoomClassifier.test.ts
    └── utils/
        └── fft.test.ts
```

---

## 9. API Specifications

### 9.1 Audio Engine API

```typescript
// ChirpGenerator
interface ChirpConfig {
  startFrequency: number;    // Hz, default: 200
  endFrequency: number;      // Hz, default: 18000
  duration: number;          // seconds, default: 0.5
  sampleRate: number;        // Hz, default: 48000
  fadeInTime: number;        // seconds, default: 0.01
  fadeOutTime: number;       // seconds, default: 0.01
}

class ChirpGenerator {
  constructor(config?: Partial<ChirpConfig>);
  generateChirp(): Float32Array;
  getInverseFilter(): Float32Array;  // For deconvolution
}

// AudioCapture
interface CaptureResult {
  audioData: Float32Array;
  sampleRate: number;
  duration: number;
  timestamp: number;
}

class AudioCapture {
  constructor(sampleRate?: number);
  requestPermission(): Promise<boolean>;
  startCapture(duration: number): Promise<CaptureResult>;
  stopCapture(): void;
  isCapturing(): boolean;
}

// ImpulseResponseExtractor
interface IRResult {
  impulseResponse: Float32Array;
  directSoundIndex: number;
  earlyReflections: Float32Array;  // 0-80ms
  lateTail: Float32Array;          // 80ms+
}

class ImpulseResponseExtractor {
  extract(
    capturedAudio: Float32Array,
    referenceChirp: Float32Array,
    inverseFilter: Float32Array,
    sampleRate: number
  ): IRResult;
}

// FeatureExtractor
interface RoomFeatures {
  rt60: number;
  edt: number;
  c50: number;
  c80: number;
  spectralCentroid: number;
  spectralRolloff: number;
  spectralFlux: number;
  earlyReflectionEnergy: number[];
  mfccMean: number[];
  mfccVar: number[];
  bandEnergy: number[];
}

class FeatureExtractor {
  extract(ir: IRResult, sampleRate: number): RoomFeatures;
  toVector(features: RoomFeatures): number[];  // Flat array for ML
}
```

### 9.2 ML Engine API

```typescript
// RoomClassifier
interface ClassificationResult {
  roomId: string;
  roomName: string;
  confidence: number;
  allProbabilities: Map<string, number>;
  entropy: number;
}

interface TrainingOptions {
  epochs: number;
  batchSize: number;
  learningRate: number;
  validationSplit: number;
  callbacks?: {
    onEpochEnd?: (epoch: number, logs: any) => void;
    onTrainingEnd?: (history: any) => void;
  };
}

class RoomClassifier {
  constructor();
  async initialize(): Promise<void>;
  async train(
    samples: TrainingSample[],
    options?: Partial<TrainingOptions>
  ): Promise<TrainingHistory>;
  predict(features: number[]): Promise<ClassificationResult>;
  async save(): Promise<void>;
  async load(): Promise<boolean>;
  getModelInfo(): ModelInfo;
}

// ModelTrainer (handles the training loop)
interface TrainingSample {
  features: number[];
  roomId: string;
  timestamp: number;
}

interface TrainingHistory {
  loss: number[];
  accuracy: number[];
  valLoss: number[];
  valAccuracy: number[];
}

class ModelTrainer {
  async trainModel(
    model: tf.LayersModel,
    samples: TrainingSample[],
    options: TrainingOptions
  ): Promise<TrainingHistory>;
}
```

### 9.3 Storage API

```typescript
// Room
interface Room {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  createdAt: number;
  updatedAt: number;
  sampleCount: number;
}

// Sample
interface Sample {
  id: string;
  roomId: string;
  features: number[];
  capturedAt: number;
  metadata?: {
    deviceInfo?: string;
    position?: string;
  };
}

// RoomStore
class RoomStore {
  async getAll(): Promise<Room[]>;
  async getById(id: string): Promise<Room | null>;
  async create(room: Omit<Room, 'id' | 'createdAt' | 'updatedAt'>): Promise<Room>;
  async update(id: string, updates: Partial<Room>): Promise<Room>;
  async delete(id: string): Promise<void>;
}

// SampleStore
class SampleStore {
  async getByRoom(roomId: string): Promise<Sample[]>;
  async getAll(): Promise<Sample[]>;
  async add(sample: Omit<Sample, 'id'>): Promise<Sample>;
  async delete(id: string): Promise<void>;
  async deleteByRoom(roomId: string): Promise<void>;
}

// ModelStore
interface StoredModel {
  id: string;
  modelJson: any;
  weights: ArrayBuffer;
  roomMapping: Map<string, number>;
  createdAt: number;
  trainingHistory: TrainingHistory;
}

class ModelStore {
  async save(model: tf.LayersModel, metadata: any): Promise<void>;
  async load(): Promise<StoredModel | null>;
  async delete(): Promise<void>;
}
```

---

## 10. Testing Strategy

### 10.1 Unit Tests

**Audio Module:**
- ChirpGenerator produces correct frequency sweep
- FFT/IFFT round-trip accuracy
- Feature extraction produces consistent results
- Deconvolution correctly extracts impulse response

**ML Module:**
- Model architecture has correct shape
- Training reduces loss
- Prediction probabilities sum to 1
- Confidence estimation is calibrated

**Storage Module:**
- CRUD operations work correctly
- Data persists across sessions
- Large datasets handled efficiently

### 10.2 Integration Tests

- Full capture → feature extraction → classification pipeline
- Training with mock data produces working model
- Model save/load preserves accuracy

### 10.3 Manual Testing Checklist

**Device Testing:**
- [ ] Test on Android Chrome
- [ ] Test on iOS Safari
- [ ] Test on desktop Chrome/Firefox
- [ ] Test on low-end devices
- [ ] Test with external microphones

**Audio Testing:**
- [ ] Chirp is audible but not annoying
- [ ] Capture works in quiet and noisy environments
- [ ] Different phone positions produce similar results
- [ ] No audio feedback loop issues

**Classification Testing:**
- [ ] Can distinguish acoustically different rooms
- [ ] Confidence correlates with actual accuracy
- [ ] Graceful handling of unknown rooms
- [ ] Performance over time (model drift)

---

## 11. Known Limitations & Mitigations

### 11.1 Technical Limitations

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| Phone speaker/mic quality varies | Different devices may give different results | Calibration step, device-specific normalization |
| Audible sound required | May be annoying, privacy concerns | Use high frequencies, short chirps, quiet mode option |
| Position sensitivity | Holding phone differently affects readings | Multiple samples, position guidance in UI |
| Background noise | Reduces accuracy | Noise estimation, quality threshold |
| Similar rooms confuse classifier | Low accuracy for acoustically similar spaces | Show confidence, suggest more training |

### 11.2 User Experience Challenges

| Challenge | Mitigation |
|-----------|------------|
| Training is tedious | Gamification, progress rewards, minimum viable samples |
| Detection feels slow | Show activity indicator, optimize processing |
| Unclear when to retrain | Confidence degradation warnings |
| Model doesn't transfer between phones | Export/import with calibration |

### 11.3 Edge Cases to Handle

- User has only 1-2 rooms (classifier needs minimum classes)
- Very large open floor plan (no distinct rooms)
- Temporary acoustic changes (party, construction)
- Furniture rearrangement invalidates model
- Phone orientation affects speaker/mic directivity

---

## Appendix A: DSP Reference

### Logarithmic Sweep Formula

```
f(t) = f1 * exp(t/T * ln(f2/f1))

where:
  f1 = start frequency
  f2 = end frequency
  T = sweep duration
  t = time (0 to T)
```

### RT60 from Schroeder Integration

```
EDC(t) = ∫[t,∞] h²(τ) dτ

RT60 = time for EDC to decay 60 dB from peak
     ≈ 60 / slope of EDC in dB/s (from -5dB to -35dB)
```

### Mel Scale Conversion

```
mel(f) = 2595 * log10(1 + f/700)
f(mel) = 700 * (10^(mel/2595) - 1)
```

---

## Appendix B: Research References

1. **Room Acoustic Fingerprinting:**
   - "Acoustic Room Fingerprinting" - IEEE Signal Processing
   - "Indoor Localization Using Acoustic Echoes" - ACM MobiSys

2. **Impulse Response Measurement:**
   - "Transfer Function Measurement with Sweeps" - AES Journal
   - ISO 3382 Room Acoustics Measurement Standard

3. **Audio Feature Extraction:**
   - "MFCC Tutorial" - Practical Cryptography
   - LibROSA documentation

4. **TensorFlow.js:**
   - Official TensorFlow.js documentation
   - "Deep Learning in the Browser" - O'Reilly

---

*This document should be updated as the project evolves and new learnings emerge.*
