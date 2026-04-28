// -------------------------------------------------------------------
// CONFIGURATION
// -------------------------------------------------------------------
// Replace these with your actual Supabase project URL and anon key
const SUPABASE_URL = 'https://pdwamawhoaqyjpmeqstf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBkd2FtYXdob2FxeWpwbWVxc3RmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczNzcwMDUsImV4cCI6MjA5Mjk1MzAwNX0.Y7fXG4ohYGBR4lWu0hveElIvgX6F2AzAxKfdgzLikmw';

// Initialize Supabase Client (renamed to supabaseClient to avoid global collision with CDN)
const supabaseClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const TARGETS = {
    WAKE_NORMAL: 15,
    WAKE_SLOW: 10,
    WAKE_FAST: 10,
    WAKE_SOFT: 10,
    WAKE_NOISE: 5,
    NON_WAKE: 20
};

const INSTRUCTIONS = {
    WAKE_NORMAL: 'Say "hey sentra" normally',
    WAKE_SLOW: 'Say "hey sentra" slowly and clearly',
    WAKE_FAST: 'Say "hey sentra" quickly but clearly',
    WAKE_SOFT: 'Speak softly or increase distance from device',
    WAKE_NOISE: 'Record with background noise (fan, people, etc.)',
    NON_WAKE: 'Say any normal sentence (NOT "hey sentra")'
};

const TOTAL_REQUIRED = Object.values(TARGETS).reduce((a, b) => a + b, 0);
const RECORDING_DURATION_MS = 2000;
const SILENCE_THRESHOLD = 5; // minimum volume required to be valid

// -------------------------------------------------------------------
// STATE
// -------------------------------------------------------------------
let currentUser = null;
let currentProgress = {
    WAKE_NORMAL: 0,
    WAKE_SLOW: 0,
    WAKE_FAST: 0,
    WAKE_SOFT: 0,
    WAKE_NOISE: 0,
    NON_WAKE: 0
};
let currentLabel = 'WAKE_NORMAL';

let mediaRecorder = null;
let audioChunks = [];
let audioBlob = null;
let audioContext = null;
let analyser = null;
let microphone = null;
let visualizerAnimation = null;
let recordingTimeout = null;
let maxVolumeRecorded = 0;

// -------------------------------------------------------------------
// DOM ELEMENTS
// -------------------------------------------------------------------
const loginSection = document.getElementById('login-section');
const dashboardSection = document.getElementById('dashboard-section');
const loginForm = document.getElementById('login-form');
const usernameInput = document.getElementById('username');
const loginError = document.getElementById('login-error');
const displayUsername = document.getElementById('display-username');
const userAvatar = document.getElementById('user-avatar');
const logoutBtn = document.getElementById('logout-btn');
const totalProgressText = document.getElementById('total-progress');
const progressList = document.getElementById('progress-list');

const currentLabelEl = document.getElementById('current-label');
const currentLabelProgressEl = document.getElementById('current-label-progress');
const currentInstructionEl = document.getElementById('current-instruction');

const startRecordBtn = document.getElementById('start-record-btn');
const stopRecordBtn = document.getElementById('stop-record-btn');
const uploadBtn = document.getElementById('upload-btn');
const discardBtn = document.getElementById('discard-btn');
const actionStatus = document.getElementById('action-status');

const audioVisualizer = document.getElementById('audio-visualizer');
const recordingIndicator = document.getElementById('recording-indicator');
const canvasCtx = audioVisualizer.getContext('2d');

const completionMessage = document.getElementById('completion-message');
const recordingInterface = document.getElementById('recording-interface');
const instructionsModal = document.getElementById('instructions-modal');
const closeInstructionsBtn = document.getElementById('close-instructions-btn');

// -------------------------------------------------------------------
// INITIALIZATION
// -------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    // Check for existing session
    try {
        const savedUsername = localStorage.getItem('voice_app_username');
        if (savedUsername) {
            loginUser(savedUsername);
        }
    } catch(e) {
        console.warn("localStorage access denied", e);
    }

    // Attach event listener inside DOMContentLoaded
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            console.log('LOGIN_BUTTON_CLICKED');
            
            const username = usernameInput.value.trim().toLowerCase();
            console.log('USERNAME_VALUE', username);
            
            if (!username || username.length < 3) {
                showLoginError('Username must be at least 3 characters.');
                return;
            }
            
            await loginUser(username);
        });
    } else {
        console.error("loginForm element not found!");
    }
});

function resizeCanvas() {
    if (audioVisualizer && audioVisualizer.parentElement) {
        audioVisualizer.width = audioVisualizer.parentElement.clientWidth;
        audioVisualizer.height = audioVisualizer.parentElement.clientHeight;
    }
}

async function loginUser(username) {
    console.log('LOGIN_STARTED', username);
    
    try {
        if (supabaseClient) {
            console.log('SUPABASE_REQUEST_STARTED');
            // Check if user exists
            const { data: existingUser, error: fetchError } = await supabaseClient
                .from('users')
                .select('id, username')
                .eq('username', username)
                .single();
                
            console.log('SUPABASE_RESPONSE', existingUser, fetchError);

            if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 is "No rows found"
                throw new Error("Error fetching user: " + fetchError.message);
            }

            let userId = null;
            if (existingUser) {
                console.log('USER_FETCH_SUCCESS', existingUser);
                userId = existingUser.id;
            } else {
                // Insert new user
                const { data: newUser, error: insertError } = await supabaseClient
                    .from('users')
                    .insert([{ username: username }])
                    .select()
                    .single();
                    
                if (insertError) throw new Error("Error creating user: " + insertError.message);
                console.log('USER_CREATED', newUser);
                userId = newUser.id;
            }
            
            if (userId) {
                localStorage.setItem('voice_app_user_id', userId);
            }
        } else {
            console.warn('Supabase not initialized, skipping DB user check');
        }

        currentUser = username;
        localStorage.setItem('voice_app_username', username);
        
        displayUsername.textContent = username;
        userAvatar.textContent = username.charAt(0).toUpperCase();
        
        loginSection.classList.remove('active');
        setTimeout(() => {
            loginSection.classList.add('hidden');
            dashboardSection.classList.remove('hidden');
            // Small delay to allow display:block to apply before animating opacity
            setTimeout(() => dashboardSection.classList.add('active'), 50);
        }, 500);

        // Show instructions modal once per session
        if (!sessionStorage.getItem('instructions_shown')) {
            instructionsModal.classList.remove('hidden');
        }

        await loadProgress();
        updateUI();
        console.log('LOGIN_SUCCESS');

    } catch (error) {
        console.error('LOGIN_ERROR', error);
        showLoginError('Failed to login: ' + error.message);
    }
}

logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('voice_app_username');
    sessionStorage.removeItem('instructions_shown');
    window.location.reload();
});

closeInstructionsBtn.addEventListener('click', () => {
    instructionsModal.classList.add('hidden');
    sessionStorage.setItem('instructions_shown', 'true');
});

function showLoginError(msg) {
    loginError.textContent = msg;
    loginError.classList.remove('hidden');
}

// -------------------------------------------------------------------
// DATABASE & PROGRESS TRACKING
// -------------------------------------------------------------------
async function loadProgress() {
    // In a real app with Supabase initialized:
    if (supabaseClient) {
        try {
            const { data, error } = await supabaseClient
                .from('recordings')
                .select('label')
                .eq('username', currentUser);
                
            if (!error && data) {
                // Reset counts
                Object.keys(TARGETS).forEach(k => currentProgress[k] = 0);
                // Aggregate
                data.forEach(row => {
                    if (currentProgress[row.label] !== undefined) {
                        currentProgress[row.label]++;
                    }
                });
            }
        } catch (err) {
            console.error("Supabase not fully configured yet. Using local state.");
        }
    } else {
        console.warn("Supabase not configured. Using local session data.");
        // Mock data for demo if no backend configured
        const localData = JSON.parse(localStorage.getItem(`progress_${currentUser}`) || '{}');
        Object.keys(TARGETS).forEach(k => {
            currentProgress[k] = localData[k] || 0;
        });
    }
}

function saveProgressLocally() {
    localStorage.setItem(`progress_${currentUser}`, JSON.stringify(currentProgress));
}

function getNextLabel() {
    for (const [label, target] of Object.entries(TARGETS)) {
        if (currentProgress[label] < target) {
            return label;
        }
    }
    return null; // All done!
}

// -------------------------------------------------------------------
// UI UPDATES
// -------------------------------------------------------------------
function updateUI() {
    currentLabel = getNextLabel();
    
    // Total progress
    const totalDone = Object.values(currentProgress).reduce((a, b) => a + b, 0);
    totalProgressText.textContent = `${totalDone} / ${TOTAL_REQUIRED} Recordings`;
    
    if (totalDone >= TOTAL_REQUIRED || !currentLabel) {
        // Show completion state
        recordingInterface.classList.add('hidden');
        completionMessage.classList.remove('hidden');
    } else {
        recordingInterface.classList.remove('hidden');
        completionMessage.classList.add('hidden');
        
        // Update current target info
        currentLabelEl.textContent = currentLabel;
        currentLabelProgressEl.textContent = `${currentProgress[currentLabel]} / ${TARGETS[currentLabel]}`;
        currentInstructionEl.textContent = INSTRUCTIONS[currentLabel];
    }
    
    // Render progress list
    progressList.innerHTML = '';
    for (const [label, target] of Object.entries(TARGETS)) {
        const count = currentProgress[label];
        const percent = Math.min(100, Math.round((count / target) * 100));
        const isComplete = count >= target;
        
        const item = document.createElement('div');
        item.className = `progress-item ${isComplete ? 'completed' : ''}`;
        item.innerHTML = `
            <div class="progress-header">
                <span class="progress-name">${label}</span>
                <span class="progress-count">${count} / ${target}</span>
            </div>
            <div class="progress-bar-bg">
                <div class="progress-bar-fill" style="width: ${percent}%"></div>
            </div>
        `;
        progressList.appendChild(item);
    }
    
    resetRecordingUI();
}

function resetRecordingUI() {
    startRecordBtn.classList.remove('hidden');
    stopRecordBtn.classList.add('hidden');
    uploadBtn.classList.add('hidden');
    discardBtn.classList.add('hidden');
    recordingIndicator.classList.add('hidden');
    actionStatus.textContent = '';
    actionStatus.style.color = 'inherit';
    audioBlob = null;
    audioChunks = [];
    maxVolumeRecorded = 0;
    
    // Clear canvas
    canvasCtx.clearRect(0, 0, audioVisualizer.width, audioVisualizer.height);
}

// -------------------------------------------------------------------
// RECORDING LOGIC
// -------------------------------------------------------------------
startRecordBtn.addEventListener('click', async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Setup Audio Context for volume checking and visualization
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        microphone = audioContext.createMediaStreamSource(stream);
        microphone.connect(analyser);
        analyser.fftSize = 256;
        
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        maxVolumeRecorded = 0;
        
        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunks.push(e.data);
        };
        
        mediaRecorder.onstop = () => {
            stream.getTracks().forEach(track => track.stop());
            if (audioContext) {
                audioContext.close();
            }
            cancelAnimationFrame(visualizerAnimation);
            recordingIndicator.classList.add('hidden');
            
            if (audioChunks.length > 0) {
                audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
                showUploadControls();
            } else {
                showErrorStatus("Recording failed. Please try again.");
                resetRecordingUI();
            }
        };
        
        mediaRecorder.start();
        startRecordBtn.classList.add('hidden');
        stopRecordBtn.classList.remove('hidden');
        recordingIndicator.classList.remove('hidden');
        actionStatus.textContent = '';
        
        visualize();
        
        // Automatically stop after 2 seconds
        recordingTimeout = setTimeout(() => {
            if (mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
            }
        }, RECORDING_DURATION_MS);
        
    } catch (err) {
        console.error("Microphone access error:", err);
        showErrorStatus("Microphone access denied or not available.");
    }
});

stopRecordBtn.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        clearTimeout(recordingTimeout);
        mediaRecorder.stop();
    }
});

function visualize() {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    function draw() {
        visualizerAnimation = requestAnimationFrame(draw);
        analyser.getByteFrequencyData(dataArray);
        
        // Check volume
        let sum = 0;
        for(let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
        }
        let averageVolume = sum / bufferLength;
        if (averageVolume > maxVolumeRecorded) {
            maxVolumeRecorded = averageVolume;
        }

        canvasCtx.fillStyle = 'rgba(30, 41, 59, 0.2)';
        canvasCtx.fillRect(0, 0, audioVisualizer.width, audioVisualizer.height);
        
        const barWidth = (audioVisualizer.width / bufferLength) * 2.5;
        let x = 0;
        
        for(let i = 0; i < bufferLength; i++) {
            const barHeight = dataArray[i] / 2;
            canvasCtx.fillStyle = `rgb(${barHeight + 100}, 99, 241)`;
            canvasCtx.fillRect(x, audioVisualizer.height - barHeight, barWidth, barHeight);
            x += barWidth + 1;
        }
    }
    draw();
}

function showUploadControls() {
    stopRecordBtn.classList.add('hidden');
    uploadBtn.classList.remove('hidden');
    discardBtn.classList.remove('hidden');
    
    // Silence Validation
    if (maxVolumeRecorded < SILENCE_THRESHOLD) {
        showErrorStatus("Recording was completely silent. Please discard and try again.");
        uploadBtn.disabled = true;
    } else {
        actionStatus.textContent = "Recording complete. Ready to upload.";
        actionStatus.style.color = "var(--success-color)";
        uploadBtn.disabled = false;
    }
}

discardBtn.addEventListener('click', () => {
    resetRecordingUI();
});

// -------------------------------------------------------------------
// UPLOAD LOGIC
// -------------------------------------------------------------------
uploadBtn.addEventListener('click', async () => {
    if (!audioBlob) return;
    
    uploadBtn.disabled = true;
    uploadBtn.innerHTML = 'Uploading...';
    discardBtn.disabled = true;
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${currentUser}_${currentLabel}_${timestamp}.wav`; // Saving with .wav extension as requested
    
    try {
        if (supabaseClient) {
            // Upload to Supabase Storage
            const { error: uploadError } = await supabaseClient.storage
                .from('audio_data')
                .upload(filename, audioBlob, {
                    cacheControl: '3600',
                    upsert: false
                });

            if (uploadError) throw uploadError;

            // Get public URL
            const { data: { publicUrl } } = supabaseClient.storage
                .from('audio_data')
                .getPublicUrl(filename);

            // Save to database
            const { error: dbError } = await supabaseClient
                .from('recordings')
                .insert([
                    {
                        username: currentUser,
                        label: currentLabel,
                        file_url: publicUrl,
                        timestamp: new Date().toISOString()
                    }
                ]);

            if (dbError) throw dbError;
        }
        
        // Update Progress Locally (Assume Success or no backend)
        currentProgress[currentLabel]++;
        saveProgressLocally();
        
        showSuccessStatus("Upload successful!");
        setTimeout(() => {
            updateUI(); // Moves to next label
        }, 1500);
        
    } catch (err) {
        console.error("Upload Error:", err);
        showErrorStatus("Failed to upload. Please try again. " + err.message);
        uploadBtn.disabled = false;
        discardBtn.disabled = false;
        uploadBtn.innerHTML = '<span class="icon">☁️</span> Upload';
    }
});

function showErrorStatus(msg) {
    actionStatus.textContent = msg;
    actionStatus.style.color = "var(--danger-color)";
}

function showSuccessStatus(msg) {
    actionStatus.textContent = msg;
    actionStatus.style.color = "var(--success-color)";
}
