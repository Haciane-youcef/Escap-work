const socket = io();
let waterChart, airChart;

// Énergie: Gestion drag & drop
let draggingNode = null;
let connections = [];
let nodes = [];

const correctConnections = [
    { start: 'L1', end: 'R3' },
    { start: 'L2', end: 'R1' },
    { start: 'L3', end: 'R4' },
    { start: 'L4', end: 'R2' }
];

let isTextToSpeechEnabled = false;

// NOUVEAU: Variables pour le chat
let lastMessageId = 0;
let chatPollingInterval = null;

// Démarrer le polling des messages au chargement
document.addEventListener('DOMContentLoaded', () => {
    startChatPolling();
    
    const messageInput = document.getElementById('message');
    if (messageInput) {
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                sendMessage();
            }
        });
    }
    
    const ttsButton = document.getElementById('tts_toggle');
    if (ttsButton) {
        updateTtsButtonText();
        window.speechSynthesis.onvoiceschanged = () => {
            console.log('Voix disponibles:', window.speechSynthesis.getVoices().length);
        };
    }
});

// NOUVEAU: Démarrer le polling des messages toutes les secondes
function startChatPolling() {
    // Charger les messages existants
    loadNewMessages();
    
    // Polling toutes les secondes
    chatPollingInterval = setInterval(() => {
        loadNewMessages();
    }, 1000);
}

// NOUVEAU: Charger les nouveaux messages
async function loadNewMessages() {
    try {
        const response = await fetch(`/api/chat/messages?last_id=${lastMessageId}`);
        const data = await response.json();
        
        if (data.messages && data.messages.length > 0) {
            data.messages.forEach(msg => {
                displayMessage(msg);
                lastMessageId = Math.max(lastMessageId, msg.id);
            });
        }
    } catch (error) {
        console.error('Erreur chargement messages:', error);
    }
}

// NOUVEAU: Afficher un message dans le chat
function displayMessage(msg) {
    const msgDiv = document.getElementById('messages');
    if (!msgDiv) return;
    
    // Vérifier si le message n'existe pas déjà
    if (document.getElementById(`msg-${msg.id}`)) {
        return;
    }
    
    const messageElement = document.createElement('p');
    messageElement.id = `msg-${msg.id}`;
    
    // Formater l'heure
    const date = new Date(msg.timestamp);
    const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    
    messageElement.innerHTML = `<span style="color: #888;">[${time}]</span> <strong>${escapeHtml(msg.username)}:</strong> ${escapeHtml(msg.message)}`;
    
    // Style pour différencier nos messages
    const currentUser = document.getElementById('welcome')?.textContent.match(/Bienvenue,\s*(\w+)/)?.[1];
    if (currentUser === msg.username) {
        messageElement.style.backgroundColor = 'rgba(74, 170, 255, 0.1)';
        messageElement.style.padding = '5px';
        messageElement.style.borderRadius = '5px';
        messageElement.style.marginBottom = '5px';
    }
    
    msgDiv.appendChild(messageElement);
    msgDiv.scrollTop = msgDiv.scrollHeight;
    
    // Lecture vocale si activée
    if (isTextToSpeechEnabled && currentUser !== msg.username) {
        readMessage(msg.username, msg.message);
    }
}

// NOUVEAU: Envoyer un message (version API REST)
async function sendMessage() {
    const input = document.getElementById('message');
    if (!input || !input.value.trim()) return;
    
    const message = input.value.trim();
    
    try {
        const response = await fetch('/api/chat/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ message })
        });
        
        const data = await response.json();
        
        if (data.success) {
            input.value = '';
            // Le message sera affiché par le polling automatiquement
            // Forcer un chargement immédiat pour un retour instantané
            loadNewMessages();
        } else {
            showNotification(data.error || 'Erreur envoi message', 'error');
        }
    } catch (error) {
        console.error('Erreur envoi message:', error);
        showNotification('Erreur réseau', 'error');
    }
}

// Connexion au serveur
socket.on('connect', () => {
    console.log('Connecté au serveur SocketIO');
    
    if (document.getElementById('energyCanvas')) {
        console.log('Initialisation du puzzle Énergie');
        initEnergyPuzzle();
    }
    if (document.getElementById('waterChart')) {
        console.log('Initialisation du graphique Eau');
        initWaterChart();
    }
    if (document.getElementById('airChart')) {
        console.log('Initialisation du graphique Air');
        initAirChart();
    }
});

// Mise à jour du timer
socket.on('timer_update', (data) => {
    const timerElement = document.getElementById('timer');
    if (timerElement) {
        const minutes = Math.floor(data.remaining / 60);
        const seconds = data.remaining % 60;
        timerElement.innerText = `Temps restant : ${minutes}:${seconds.toString().padStart(2, '0')}`;
        
        if (data.remaining < 60) {
            timerElement.style.color = '#ff5555';
            timerElement.style.animation = 'pulse 1s infinite';
        } else if (data.remaining < 180) {
            timerElement.style.color = '#ffaa00';
        }
    }
});

// Mise à jour des états du jeu
socket.on('state_update', (states) => {
    const updateElement = (id, value) => {
        const element = document.getElementById(id);
        if (element) {
            element.innerText = Math.round(value);
            
            if (value >= 70) {
                element.style.color = '#55ff55';
            } else if (value >= 40) {
                element.style.color = '#ffaa00';
            } else {
                element.style.color = '#ff5555';
            }
        }
    };
    
    updateElement('energy_level', states.energy_level);
    updateElement('water_pollution', states.water_pollution);
    updateElement('air_co2', states.air_co2);
    updateElement('air_o2', states.air_o2);
    updateElement('flora_health', states.flora_health);
    
    if (waterChart) {
        waterChart.data.datasets[0].data = [states.water_pollution, 100 - states.water_pollution];
        waterChart.update();
    }
    if (airChart) {
        airChart.data.datasets[0].data = [states.air_co2, states.air_o2];
        airChart.update();
    }
});

// Feedback des actions
socket.on('feedback', (data) => {
    console.log('Feedback reçu:', data.message);
    showNotification(data.message, 'info');
});

// Puzzle complété
socket.on('puzzle_completed', (data) => {
    showNotification(`🎉 Énigme de la salle ${data.room} terminée!`, 'success');
    createConfetti();
});

// Salle déverrouillée
socket.on('room_unlocked', (data) => {
    showNotification(`🔓 Salle ${data.room} débloquée!`, 'success');
});

// Fin de partie
socket.on('game_over', (data) => {
    console.log('Game over:', data.message);
    showNotification(data.message, 'warning');
});

// Victoire
socket.on('victory', (states) => {
    console.log('Victoire:', states);
    showVictoryScreen(states);
});

// Défaite
socket.on('defeat', (states) => {
    console.log('Défaite:', states);
    showDefeatScreen(states);
});

// Erreurs
socket.on('error', (data) => {
    console.log('Erreur reçue:', data.message);
    showNotification(data.message, 'error');
});

// ==================== FONCTIONS UTILITAIRES ====================

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showNotification(message, type) {
    const notification = document.createElement('div');
    notification.style.position = 'fixed';
    notification.style.top = '20px';
    notification.style.right = '20px';
    notification.style.padding = '15px 25px';
    notification.style.borderRadius = '8px';
    notification.style.color = 'white';
    notification.style.fontWeight = 'bold';
    notification.style.zIndex = '10000';
    notification.style.boxShadow = '0 4px 20px rgba(0,0,0,0.3)';
    notification.style.animation = 'slideIn 0.3s ease-out';
    notification.textContent = message;
    
    const colors = {
        'info': '#3498db',
        'success': '#55ff55',
        'warning': '#ffaa00',
        'error': '#ff5555'
    };
    notification.style.background = colors[type] || colors['info'];
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-in';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

function showVictoryScreen(states) {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.background = 'rgba(0, 0, 0, 0.95)';
    overlay.style.zIndex = '9999';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.animation = 'fadeIn 0.5s ease-out';
    
    overlay.innerHTML = `
        <div style="text-align: center; color: white;">
            <h1 style="color: #55ff55; font-size: 60px; margin: 20px; text-shadow: 0 0 20px #55ff55;">
                🎉 VICTOIRE! 🎉
            </h1>
            <p style="font-size: 24px; margin: 20px;">Vous avez sauvé l'écosystème!</p>
            <div style="margin: 30px; font-size: 18px; background: rgba(0,0,0,0.5); padding: 20px; border-radius: 10px; display: inline-block;">
                <p>⚡ Énergie: <span style="color: #55ff55; font-weight: bold;">${Math.round(states.energy_level)}%</span></p>
                <p>💧 Pollution Eau: <span style="color: #55ff55; font-weight: bold;">${Math.round(states.water_pollution)}%</span></p>
                <p>💨 CO₂ Air: <span style="color: #55ff55; font-weight: bold;">${Math.round(states.air_co2)}%</span></p>
                <p>💨 O₂ Air: <span style="color: #55ff55; font-weight: bold;">${Math.round(states.air_o2)}%</span></p>
                <p>🌿 Santé Flore: <span style="color: #55ff55; font-weight: bold;">${Math.round(states.flora_health)}%</span></p>
            </div>
            <br>
            <button onclick="window.location.href='/'" style="
                background: #55ff55;
                color: #1a1a1a;
                border: none;
                padding: 15px 40px;
                font-size: 20px;
                border-radius: 8px;
                cursor: pointer;
                margin: 10px;
                font-weight: bold;
            ">Retour au lobby</button>
        </div>
    `;
    
    document.body.appendChild(overlay);
    createConfetti(100);
}

function showDefeatScreen(states) {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.background = 'rgba(0, 0, 0, 0.95)';
    overlay.style.zIndex = '9999';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.animation = 'fadeIn 0.5s ease-out';
    
    overlay.innerHTML = `
        <div style="text-align: center; color: white;">
            <h1 style="color: #ff5555; font-size: 60px; margin: 20px; text-shadow: 0 0 20px #ff5555;">
                😢 DÉFAITE
            </h1>
            <p style="font-size: 24px; margin: 20px;">L'écosystème n'a pas pu être sauvé...</p>
            <div style="margin: 30px; font-size: 18px; background: rgba(0,0,0,0.5); padding: 20px; border-radius: 10px; display: inline-block;">
                <p>⚡ Énergie: <span style="color: ${states.energy_level >= 50 ? '#55ff55' : '#ff5555'}; font-weight: bold;">${Math.round(states.energy_level)}%</span></p>
                <p>💧 Pollution Eau: <span style="color: ${states.water_pollution <= 50 ? '#55ff55' : '#ff5555'}; font-weight: bold;">${Math.round(states.water_pollution)}%</span></p>
                <p>💨 CO₂ Air: <span style="color: ${states.air_co2 <= 50 ? '#55ff55' : '#ff5555'}; font-weight: bold;">${Math.round(states.air_co2)}%</span></p>
                <p>💨 O₂ Air: <span style="color: ${states.air_o2 >= 50 ? '#55ff55' : '#ff5555'}; font-weight: bold;">${Math.round(states.air_o2)}%</span></p>
                <p>🌿 Santé Flore: <span style="color: ${states.flora_health >= 50 ? '#55ff55' : '#ff5555'}; font-weight: bold;">${Math.round(states.flora_health)}%</span></p>
            </div>
            <br>
            <button onclick="window.location.href='/'" style="
                background: #ff5555;
                color: white;
                border: none;
                padding: 15px 40px;
                font-size: 20px;
                border-radius: 8px;
                cursor: pointer;
                margin: 10px;
                font-weight: bold;
            ">Réessayer</button>
        </div>
    `;
    
    document.body.appendChild(overlay);
}

function createConfetti(count = 50) {
    for (let i = 0; i < count; i++) {
        setTimeout(() => {
            const confetti = document.createElement('div');
            confetti.style.position = 'fixed';
            confetti.style.width = '10px';
            confetti.style.height = '10px';
            confetti.style.background = ['#55ff55', '#ffaa00', '#5599ff', '#ff5555'][Math.floor(Math.random() * 4)];
            confetti.style.left = Math.random() * 100 + '%';
            confetti.style.top = '-10px';
            confetti.style.zIndex = '10001';
            confetti.style.borderRadius = '50%';
            confetti.style.animation = `fall ${2 + Math.random() * 3}s linear`;
            
            document.body.appendChild(confetti);
            
            setTimeout(() => confetti.remove(), 5000);
        }, i * 30);
    }
}

// ==================== ACTIONS DU JEU ====================

function sendAction(action, data = {}) {
    data.action = action;
    console.log('Envoi action:', action, data);
    socket.emit('action', data);
}

// ==================== RECONNAISSANCE VOCALE ====================

let recognition = null;

function startVoice() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        console.error('Reconnaissance vocale non supportée');
        showNotification('Reconnaissance vocale non supportée par ce navigateur.', 'error');
        return;
    }
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.lang = 'fr-FR';
    recognition.continuous = false;
    recognition.interimResults = false;
    
    recognition.onstart = () => {
        console.log('Reconnaissance vocale démarrée');
        showNotification('🎤 Parlez maintenant...', 'info');
    };
    
    recognition.onresult = async (event) => {
        const transcript = event.results[0][0].transcript;
        console.log('Message vocal:', transcript);
        
        // Envoyer via l'API
        const input = document.getElementById('message');
        if (input) {
            input.value = transcript;
            await sendMessage();
        }
    };
    
    recognition.onerror = (event) => {
        console.error('Erreur reconnaissance vocale:', event.error);
        showNotification('Erreur de reconnaissance vocale', 'error');
    };
    
    recognition.onend = () => {
        console.log('Reconnaissance vocale terminée');
    };
    
    recognition.start();
}

function readMessage(user, message) {
    if ('speechSynthesis' in window) {
        console.log('Synthèse vocale: préparation de la lecture...');
        
        window.speechSynthesis.cancel();
        
        const utterance = new SpeechSynthesisUtterance(`${user} dit : ${message}`);
        utterance.lang = 'fr-FR';
        utterance.volume = 1.0;
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        
        const setVoice = () => {
            const voices = window.speechSynthesis.getVoices();
            const frenchVoice = voices.find(voice => voice.lang === 'fr-FR' || voice.lang.startsWith('fr'));
            if (frenchVoice) {
                utterance.voice = frenchVoice;
                console.log('Voix française sélectionnée:', frenchVoice.name);
            }
            window.speechSynthesis.speak(utterance);
        };
        
        if (window.speechSynthesis.getVoices().length > 0) {
            setVoice();
        } else {
            window.speechSynthesis.onvoiceschanged = setVoice;
        }
    } else {
        console.error('Synthèse vocale non supportée');
    }
}

function toggleTextToSpeech() {
    isTextToSpeechEnabled = !isTextToSpeechEnabled;
    console.log('Synthèse vocale:', isTextToSpeechEnabled ? 'activée' : 'désactivée');
    updateTtsButtonText();
    showNotification(
        isTextToSpeechEnabled ? '🔊 Lecture vocale activée' : '🔇 Lecture vocale désactivée',
        'info'
    );
}

function updateTtsButtonText() {
    const ttsButton = document.getElementById('tts_toggle');
    if (ttsButton) {
        ttsButton.innerText = isTextToSpeechEnabled ? 'Désactiver la lecture vocale' : 'Activer la lecture vocale';
    }
}

// ==================== PUZZLE ÉNERGIE ====================

function initEnergyPuzzle() {
    const canvas = document.getElementById('energyCanvas');
    if (!canvas) {
        console.error('Erreur: canvas energyCanvas non trouvé');
        return;
    }
    const ctx = canvas.getContext('2d');

    const colors = ['red', 'blue', 'yellow', 'green'];
    const shuffledColors = [...colors].sort(() => Math.random() - 0.5);

    nodes = [
        { x: 50, y: 50, id: 'L1', color: '#808080', side: 'left' },
        { x: 50, y: 150, id: 'L2', color: '#808080', side: 'left' },
        { x: 50, y: 250, id: 'L3', color: '#808080', side: 'left' },
        { x: 50, y: 350, id: 'L4', color: '#808080', side: 'left' },
        { x: 550, y: 50, id: 'R1', color: shuffledColors[0], side: 'right' },
        { x: 550, y: 150, id: 'R2', color: shuffledColors[1], side: 'right' },
        { x: 550, y: 250, id: 'R3', color: shuffledColors[2], side: 'right' },
        { x: 550, y: 350, id: 'R4', color: shuffledColors[3], side: 'right' }
    ];

    function draw() {
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        for (let i = 0; i < canvas.width; i += 50) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i, canvas.height);
            ctx.stroke();
        }
        for (let i = 0; i < canvas.height; i += 50) {
            ctx.beginPath();
            ctx.moveTo(0, i);
            ctx.lineTo(canvas.width, i);
            ctx.stroke();
        }

        connections.forEach(conn => {
            const start = nodes.find(n => n.id === conn.start);
            const end = nodes.find(n => n.id === conn.end);
            if (start && end) {
                ctx.beginPath();
                ctx.moveTo(start.x, start.y);
                ctx.lineTo(end.x, end.y);
                ctx.strokeStyle = end.color;
                ctx.lineWidth = 10;
                ctx.stroke();
                
                ctx.strokeStyle = 'rgba(0,0,0,0.3)';
                ctx.lineWidth = 12;
                ctx.stroke();
            }
        });

        nodes.forEach(node => {
            ctx.beginPath();
            ctx.arc(node.x + 2, node.y + 2, 15, 0, 2 * Math.PI);
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fill();
            
            ctx.beginPath();
            ctx.arc(node.x, node.y, 15, 0, 2 * Math.PI);
            ctx.fillStyle = node.color;
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 3;
            ctx.stroke();
            
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 14px Arial';
            ctx.fillText(node.id, node.x + 20, node.y + 5);
        });
    }

    canvas.addEventListener('mousedown', (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        draggingNode = nodes.find(node => Math.hypot(node.x - x, node.y - y) < 15 && node.side === 'left');
        if (draggingNode) {
            console.log('Début drag:', draggingNode.id);
            canvas.style.cursor = 'grabbing';
        }
    });

    canvas.addEventListener('mouseup', (e) => {
        if (draggingNode) {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const target = nodes.find(node => Math.hypot(node.x - x, node.y - y) < 15 && node.side === 'right');
            
            if (target) {
                connections = connections.filter(c => c.start !== draggingNode.id);
                connections.push({ start: draggingNode.id, end: target.id });
                console.log('Connexion ajoutée:', draggingNode.id, '->', target.id);
                draw();
            }
            
            draggingNode = null;
            canvas.style.cursor = 'crosshair';
        }
    });

    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const hover = nodes.find(node => Math.hypot(node.x - x, node.y - y) < 15);
        canvas.style.cursor = hover ? 'pointer' : 'crosshair';
    });

    connections = [];
    draw();
}

function showImageModal() {
    const modal = document.getElementById('imageModal');
    modal.style.display = 'flex';
}


function checkConnections() {
    const correct = connections.length === 4 && correctConnections.every(correctConn => {
        return connections.some(conn => 
            conn.start === correctConn.start && conn.end === correctConn.end
        );
    });
    
    console.log('Vérification connexions:', { correct, connections });
    sendAction('connect_cables', { correct });
    
    if (correct) {
    
        setTimeout(() => {
            showImageModal(); // Appel de la fonction d’affichage
        }, 3000); // Appell
    } else {
        connections = [];
        initEnergyPuzzle();
    }
}

function closeImageModal() {
    const modal = document.getElementById('imageModal');
    modal.style.display = 'none';
}


// ==================== PUZZLE EAU ====================

function initWaterChart() {
    const ctx = document.getElementById('waterChart');
    if (!ctx) {
        console.error('Erreur: canvas waterChart non trouvé');
        return;
    }
    waterChart = new Chart(ctx.getContext('2d'), {
        type: 'bar',
        data: {
            labels: ['Pollution', 'Propreté'],
            datasets: [{
                label: 'Niveaux Eau (%)',
                data: [30, 70],
                backgroundColor: ['#ff5555', '#55ff55'],
                borderColor: ['#ff3333', '#33ff33'],
                borderWidth: 2
            }]
        },
        options: { 
            responsive: true,
            maintainAspectRatio: true,
            scales: { 
                y: { 
                    beginAtZero: true, 
                    max: 100,
                    ticks: { color: 'white' },
                    grid: { color: 'rgba(255,255,255,0.1)' }
                },
                x: {
                    ticks: { color: 'white' },
                    grid: { color: 'rgba(255,255,255,0.1)' }
                }
            },
            plugins: {
                legend: {
                    labels: { color: 'white', font: { size: 14 } }
                }
            }
        }
    });
}

// ==================== PUZZLE AIR ====================

function initAirChart() {
    const ctx = document.getElementById('airChart');
    if (!ctx) {
        console.error('Erreur: canvas airChart non trouvé');
        return;
    }
    airChart = new Chart(ctx.getContext('2d'), {
        type: 'bar',
        data: {
            labels: ['CO₂', 'O₂'],
            datasets: [{
                label: 'Niveaux Air (%)',
                data: [40, 60],
                backgroundColor: ['#ff5555', '#55ff55'],
                borderColor: ['#ff3333', '#33ff33'],
                borderWidth: 2
            }]
        },
        options: { 
            responsive: true,
            maintainAspectRatio: true,
            scales: { 
                y: { 
                    beginAtZero: true, 
                    max: 100,
                    ticks: { color: 'white' },
                    grid: { color: 'rgba(255,255,255,0.1)' }
                },
                x: {
                    ticks: { color: 'white' },
                    grid: { color: 'rgba(255,255,255,0.1)' }
                }
            },
            plugins: {
                legend: {
                    labels: { color: 'white', font: { size: 14 } }
                }
            }
        }
    });
}

// ==================== ANIMATIONS CSS ====================

const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
    
    @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
    }
    
    @keyframes fall {
        to {
            transform: translateY(100vh) rotate(360deg);
            opacity: 0;
        }
    }
    
    @keyframes pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.8; transform: scale(1.05); }
    }
`;
document.head.appendChild(style);

// ==================== PUZZLE EAU - LOGIQUE ====================

let purity = 0;
let ph = 5.6;
let o2 = 3.2;
let wastes = [];
const wasteTypes = ['plastic', 'metal', 'organic'];
const wasteImages = {
    plastic: 'bottle.png',
    metal: 'battery.png',
    organic: 'fish.png'
};

let currentDraggedWaste = null;

function initWaterPuzzle() {
    const river = document.getElementById('river');
    if (!river) {
        console.error('Erreur : conteneur du fleuve non trouvé');
        return;
    }

    const images = Object.values(wasteImages);
    images.forEach(src => {
        const img = new Image();
        img.src = `/static/${src}`;
        img.onload = () => console.log(`Image chargée : ${src}`);
        img.onerror = () => console.error(`Erreur de chargement de l'image : ${src}`);
    });

    for (let i = 0; i < 5; i++) {
        generateWaste(true);
    }

    setInterval(generateWaste, 3500);

    setupBins();
    setupChemicalControls();
}

function setupBins() {
    const bins = document.querySelectorAll('.bin');
    
    bins.forEach(bin => {
        bin.addEventListener('dragover', e => {
            e.preventDefault();
            bin.classList.add('drag-over');
        });
        
        bin.addEventListener('dragleave', () => {
            bin.classList.remove('drag-over');
        });
        
        bin.addEventListener('drop', e => {
            e.preventDefault();
            bin.classList.remove('drag-over');
            handleWasteDrop(bin, currentDraggedWaste);
        });

        bin.addEventListener('touchstart', e => {
            e.preventDefault();
        });
        
        bin.addEventListener('touchmove', e => {
            e.preventDefault();
            const touch = e.touches[0];
            const element = document.elementFromPoint(touch.clientX, touch.clientY);
            
            bins.forEach(b => b.classList.remove('drag-over'));
            if (element && element.classList.contains('bin')) {
                element.classList.add('drag-over');
            }
        });
        
        bin.addEventListener('touchend', e => {
            e.preventDefault();
            bins.forEach(b => b.classList.remove('drag-over'));
            
            if (currentDraggedWaste) {
                const touch = e.changedTouches[0];
                const element = document.elementFromPoint(touch.clientX, touch.clientY);
                
                if (element && element.classList.contains('bin')) {
                    handleWasteDrop(element, currentDraggedWaste);
                }
            }
        });
    });
}

function handleWasteDrop(bin, waste) {
    if (!waste) return;
    
    const wasteType = waste.dataset.type;
    const binType = bin.dataset.type;
    
    if (wasteType === binType) {
        updatePurity(5);
        sendAction('sort_waste', { correct: true });
        showNotification('✅ Bon tri ! Pureté augmentée.', 'success');
        createSplashEffect(waste);
    } else {
        updatePurity(-3);
        sendAction('sort_waste', { correct: false });
        showNotification('❌ Mauvais tri. Pollution accrue.', 'error');
    }
    
    waste.remove();
    wastes = wastes.filter(w => w !== waste);
    currentDraggedWaste = null;
}

function createSplashEffect(waste) {
    const splash = document.createElement('div');
    splash.className = 'splash-effect';
    splash.style.left = waste.style.left;
    splash.style.top = waste.style.top;
    document.getElementById('river').appendChild(splash);
    
    setTimeout(() => splash.remove(), 500);
}

function generateWaste(initial = false) {
    const river = document.getElementById('river');
    if (!river) return;

    const type = wasteTypes[Math.floor(Math.random() * wasteTypes.length)];
    const waste = document.createElement('img');

    waste.src = `/static/${wasteImages[type]}`;
    waste.classList.add('waste');
    waste.id = `waste-${Date.now()}-${Math.random()}`;
    waste.dataset.type = type;
    waste.draggable = true;

    waste.style.top = `${20 + Math.random() * 60}%`;
    waste.style.zIndex = 1000;

    if (initial) {
        const randomStart = Math.random() * (river.offsetWidth / 2);
        waste.style.right = randomStart + 'px';
    } else {
        waste.style.right = '-100px';
    }

    waste.addEventListener('dragstart', e => {
        currentDraggedWaste = waste;
        waste.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
    });

    waste.addEventListener('dragend', () => {
        waste.classList.remove('dragging');
    });

    let touchStartX, touchStartY;
    let wasteStartLeft, wasteStartTop;

    waste.addEventListener('touchstart', e => {
        e.preventDefault();
        currentDraggedWaste = waste;
        waste.classList.add('dragging');

        const touch = e.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;

        const rect = waste.getBoundingClientRect();
        wasteStartLeft = rect.left;
        wasteStartTop = rect.top;

        waste.style.position = 'fixed';
        waste.style.left = wasteStartLeft + 'px';
        waste.style.top = wasteStartTop + 'px';
        waste.style.right = 'auto';
    });

    waste.addEventListener('touchmove', e => {
        e.preventDefault();
        const touch = e.touches[0];
        const deltaX = touch.clientX - touchStartX;
        const deltaY = touch.clientY - touchStartY;
        waste.style.left = (wasteStartLeft + deltaX) + 'px';
        waste.style.top = (wasteStartTop + deltaY) + 'px';
    });

    waste.addEventListener('touchend', () => {
        waste.classList.remove('dragging');
    });

    river.appendChild(waste);
    wastes.push(waste);

    const duration = 30000;
    const startTime = initial ? (Date.now() - Math.random() * 15000) : Date.now();

    function animateWaste() {
        const elapsed = Date.now() - startTime;
        const progress = elapsed / duration;

        if (progress >= 1 || !document.body.contains(waste)) {
            waste.remove();
            wastes = wastes.filter(w => w !== waste);
            return;
        }

        const riverWidth = river.offsetWidth;
        const wasteWidth = 60;
        const totalDistance = riverWidth + wasteWidth + 100;
        const currentPosition = -100 + (progress * totalDistance);
        waste.style.right = currentPosition + 'px';

        requestAnimationFrame(animateWaste);
    }

    requestAnimationFrame(animateWaste);
}

function setupChemicalControls() {
    const addLimeBtn = document.getElementById('add-lime');
    const activateAeratorBtn = document.getElementById('activate-aerator');
    const validateBtn = document.getElementById('validate-chemical');
    
    if (addLimeBtn) {
        addLimeBtn.addEventListener('click', () => {
            ph = Math.min(9.0, ph + 0.2);
            document.getElementById('ph-value').innerText = ph.toFixed(1);
            sendAction('adjust_ph', { value: ph });
            updateGaugeColor('ph-value', ph, 6.5, 7.5);
        });
    }

    if (activateAeratorBtn) {
        activateAeratorBtn.addEventListener('click', () => {
            o2 = Math.min(10.0, o2 + 0.5);
            document.getElementById('o2-value').innerText = o2.toFixed(1);
            sendAction('adjust_o2', { value: o2 });
            updateGaugeColor('o2-value', o2, 7.5, 8.5);
        });
    }

    if (validateBtn) {
        validateBtn.addEventListener('click', () => {
            const phCorrect = Math.abs(ph - 7.0) < 0.5;
            const o2Correct = Math.abs(o2 - 8.0) < 0.5;
            const correct = phCorrect && o2Correct;
            
            sendAction('validate_chemical', { correct, ph, o2 });
            
            if (correct) {
                updatePurity(50);
                showNotification('🎉 Équilibre chimique atteint !', 'success');
                document.getElementById('river').classList.remove('polluted');
                document.getElementById('river').classList.add('clean');
                createFishAnimations();
            } else {
                let message = 'Déséquilibre détecté: ';
                if (!phCorrect) message += 'pH incorrect (visez ~7.0) ';
                if (!o2Correct) message += 'O₂ incorrect (visez ~8.0 mg/L)';
                showNotification(message, 'error');
            }
        });
    }
}

function updateGaugeColor(elementId, value, minTarget, maxTarget) {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    if (value >= minTarget && value <= maxTarget) {
        element.style.color = '#55ff55';
    } else if (Math.abs(value - (minTarget + maxTarget) / 2) < 1) {
        element.style.color = '#ffaa00';
    } else {
        element.style.color = '#ff5555';
    }
}

function updatePurity(delta) {
    purity = Math.max(0, Math.min(100, purity + delta));
    document.getElementById('purity-level').innerText = `${purity}%`;
    
    const purityBar = document.getElementById('purity-bar');
    if (purityBar) {
        purityBar.value = purity;
    }

    const river = document.getElementById('river');
    const filterValue = 100 - purity;
    river.style.filter = `grayscale(${filterValue}%) brightness(${50 + purity / 2}%)`;

    if (purity >= 50) {
        document.getElementById('waste-sorting').classList.remove('active');
        document.getElementById('chemical-neutralization').classList.add('active');
    }
    
    if (purity >= 100) {
        sendAction('complete_water', { purity });
    }
}

function createFishAnimations() {
    const river = document.getElementById('river');
    for (let i = 0; i < 5; i++) {
        setTimeout(() => {
            const fish = document.createElement('img');
            fish.src = '/static/fish.png';
            fish.classList.add('fish');
            fish.style.left = `${100 + Math.random() * 20}%`;
            fish.style.top = `${20 + Math.random() * 60}%`;
            fish.style.zIndex = 999;
            river.appendChild(fish);
            
            fish.animate([
                { transform: 'translateX(0) scaleX(1)' },
                { transform: 'translateX(-120vw) scaleX(1)' }
            ], {
                duration: 12000 + Math.random() * 8000,
                iterations: Infinity,
                easing: 'linear'
            });
        }, i * 1000);
    }
}

socket.on('puzzle_completed', (data) => {
    if (data.room === 'Eau') {
        showNotification('🌊 Le fleuve est purifié ! Flux vers les autres salles.', 'success');

        setTimeout(() => {
            showImageModal(); // Appel de la fonction d’affichage
        }, 3000);


        const riverSound = document.getElementById('river-sound');
        if (riverSound) {
            const playSound = () => {
                riverSound.play().catch(err => console.warn('Impossible de jouer le son :', err));
            };

            if (document.body.dataset.userInteracted) {
                playSound();
            } else {
                document.addEventListener('click', () => {
                    document.body.dataset.userInteracted = true;
                    playSound();
                }, { once: true });
            }
        }
    }
});

socket.on('redirect_to_final', () => {
    showNotification('🔐 Redirection vers le code final...', 'success');
    setTimeout(() => {
        window.location.href = '/final_code';
    }, 2000);
});


// NOUVEAU: Écouter l'événement de victoire globale
socket.on('victory_achieved', (data) => {
    console.log('Victoire détectée:', data);
    showNotification(`🎉 ${data.validator} a trouvé le code secret ! Redirection...`, 'success');
    
    setTimeout(() => {
        window.location.href = '/victory';
    }, 3000);
});