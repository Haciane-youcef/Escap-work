from flask import Flask, render_template, request, session, redirect, url_for, jsonify
from flask_socketio import SocketIO, emit
import flask_socketio
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, timedelta
import eventlet

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///database.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)
socketio = SocketIO(app, async_mode='eventlet')

# DB Models
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    room = db.Column(db.String(50))
    is_ready = db.Column(db.Boolean, default=False)

class GameState(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(50), unique=True)
    value = db.Column(db.Float)

class RoomStatus(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    room_name = db.Column(db.String(50), unique=True)
    is_completed = db.Column(db.Boolean, default=False)
    is_locked = db.Column(db.Boolean, default=True)
    assigned_player = db.Column(db.String(80))

class GameInfo(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(50), unique=True)
    value = db.Column(db.String(200))

# NOUVEAU: Modèle pour les messages de chat
class ChatMessage(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), nullable=False)
    message = db.Column(db.Text, nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'message': self.message,
            'timestamp': self.timestamp.isoformat()
        }

# Create tables
with app.app_context():
    db.create_all()
    
    # États initiaux du jeu
    initial_states = {
        'energy_level': 50.0,
        'water_pollution': 30.0,
        'air_co2': 40.0,
        'air_o2': 60.0,
        'flora_health': 60.0
    }
    for key, value in initial_states.items():
        if not GameState.query.filter_by(key=key).first():
            db.session.add(GameState(key=key, value=value))
    
    # Initialiser les statuts des salles
    rooms = ['Energie','Eau', 'Air', 'Flore']
    for i, room in enumerate(rooms):
        if not RoomStatus.query.filter_by(room_name=room).first():
            db.session.add(RoomStatus(
                room_name=room,
                is_completed=False,
                is_locked=(i != 0)
            ))
    
    # Initialiser les infos du jeu
    if not GameInfo.query.filter_by(key='game_started').first():
        db.session.add(GameInfo(key='game_started', value='false'))
    if not GameInfo.query.filter_by(key='game_end_time').first():
        db.session.add(GameInfo(key='game_end_time', value=''))
    
    db.session.commit()

# Global timer
timer_greenlet = None

def start_timer():
    """Timer global qui met à jour la BDD"""
    with app.app_context():
        game_end_time = datetime.now() + timedelta(minutes=10)
        game_info = GameInfo.query.filter_by(key='game_end_time').first()
        game_info.value = game_end_time.isoformat()
        db.session.commit()
        
        while datetime.now() < game_end_time:
            eventlet.sleep(1)
        
        check_victory()

def check_victory():
    """Vérifie les conditions de victoire et met à jour la BDD"""
    with app.app_context():
        states = {gs.key: gs.value for gs in GameState.query.all()}
        all_completed = all(rs.is_completed for rs in RoomStatus.query.all())
        
        if all_completed and all(v >= 50 for v in states.values()):
            game_info = GameInfo.query.filter_by(key='game_result').first()
            if not game_info:
                game_info = GameInfo(key='game_result', value='victory')
                db.session.add(game_info)
            else:
                game_info.value = 'victory'
            db.session.commit()
        else:
            game_info = GameInfo.query.filter_by(key='game_result').first()
            if not game_info:
                game_info = GameInfo(key='game_result', value='defeat')
                db.session.add(game_info)
            else:
                game_info.value = 'defeat'
            db.session.commit()

def unlock_next_room(completed_room):
    """Débloque la salle suivante après qu'une salle soit complétée"""
    room_order = ['Energie', 'Eau', 'Air', 'Flore']
    try:
        current_index = room_order.index(completed_room)
        if current_index < len(room_order) - 1:
            next_room_name = room_order[current_index + 1]
            next_room = RoomStatus.query.filter_by(room_name=next_room_name).first()
            if next_room:
                next_room.is_locked = False
                db.session.commit()
    except ValueError:
        pass

# ==================== ROUTES HTTP ====================

@app.route('/')
def index():
    if 'username' not in session:
        return redirect(url_for('login'))
    return redirect(url_for('lobby'))

@app.route('/lobby')
def lobby():
    if 'username' not in session:
        return redirect(url_for('login'))
    
    with app.app_context():
        users = User.query.all()
        rooms = RoomStatus.query.all()
        return render_template('lobby.html', 
                             username=session['username'],
                             users=users,
                             rooms=rooms)

@app.route('/game')
def game():
    if 'username' not in session:
        return redirect(url_for('login'))
    
    with app.app_context():
        user = User.query.filter_by(username=session['username']).first()
        if not user or not user.room:
            return redirect(url_for('lobby'))
        
        room = user.room
        session['room'] = room
        
        room_status = RoomStatus.query.filter_by(room_name=room).first()
        game_started_info = GameInfo.query.filter_by(key='game_started').first()
        game_started = game_started_info and game_started_info.value == 'true'
        
        if game_started and room_status.is_locked:
            return redirect(url_for('lobby'))
        
        if room == 'Energie':
            return render_template('energy.html', username=session['username'])
        elif room == 'Eau':
            return render_template('water.html', username=session['username'])
        elif room == 'Air':
            return render_template('air.html', username=session['username'])
        elif room == 'Flore':
            return render_template('flora.html', username=session['username'])
        else:
            return redirect(url_for('lobby'))

# ==================== API POLLING ====================

@app.route('/api/poll_status')
def poll_status():
    """API REST pour que le client consulte la BDD toutes les 1s"""
    if 'username' not in session:
        return jsonify({'error': 'Not logged in'}), 401
    
    with app.app_context():
        users = User.query.all()
        rooms = RoomStatus.query.all()
        states = GameState.query.all()
        game_started_info = GameInfo.query.filter_by(key='game_started').first()
        game_end_time_info = GameInfo.query.filter_by(key='game_end_time').first()
        game_result_info = GameInfo.query.filter_by(key='game_result').first()
        
        current_user = User.query.filter_by(username=session['username']).first()
        
        can_access_game = False
        if current_user and current_user.room and current_user.is_ready:
            room_status = RoomStatus.query.filter_by(room_name=current_user.room).first()
            if room_status and not room_status.is_locked:
                can_access_game = True
        
        remaining_time = 0
        if game_end_time_info and game_end_time_info.value:
            try:
                end_time = datetime.fromisoformat(game_end_time_info.value)
                remaining_time = max(0, int((end_time - datetime.now()).total_seconds()))
            except:
                pass
        
        return jsonify({
            'players': [
                {
                    'username': u.username,
                    'room': u.room,
                    'is_ready': u.is_ready
                } for u in users
            ],
            'rooms': [
                {
                    'name': r.room_name,
                    'is_locked': r.is_locked,
                    'is_completed': r.is_completed,
                    'assigned_player': r.assigned_player
                } for r in rooms
            ],
            'game_states': {
                gs.key: gs.value for gs in states
            },
            'game_started': game_started_info.value if game_started_info else 'false',
            'remaining_time': remaining_time,
            'can_access_game': can_access_game,
            'game_result': game_result_info.value if game_result_info else None
        })

# NOUVEAU: API pour récupérer les messages
@app.route('/api/chat/messages')
def get_chat_messages():
    """Récupère les messages depuis un certain ID"""
    if 'username' not in session:
        return jsonify({'error': 'Not logged in'}), 401
    
    # Paramètre optionnel: dernier ID connu par le client
    last_id = request.args.get('last_id', 0, type=int)
    
    with app.app_context():
        # Récupérer uniquement les nouveaux messages
        messages = ChatMessage.query.filter(ChatMessage.id > last_id).order_by(ChatMessage.timestamp.asc()).all()
        
        return jsonify({
            'messages': [msg.to_dict() for msg in messages]
        })

# NOUVEAU: API pour envoyer un message
@app.route('/api/chat/send', methods=['POST'])
def send_chat_message():
    """Enregistre un nouveau message dans la BDD"""
    if 'username' not in session:
        return jsonify({'error': 'Not logged in'}), 401
    
    data = request.get_json()
    message_text = data.get('message', '').strip()
    
    if not message_text:
        return jsonify({'error': 'Message vide'}), 400
    
    if len(message_text) > 500:
        return jsonify({'error': 'Message trop long'}), 400
    
    with app.app_context():
        new_message = ChatMessage(
            username=session['username'],
            message=message_text
        )
        db.session.add(new_message)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': new_message.to_dict()
        })

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form['username']
        with app.app_context():
            user = User.query.filter_by(username=username).first()
            if user:
                return render_template('login.html', 
                                     error=True,
                                     error_message='''<p>Ce nom d'utilisateur est déjà pris!</p>''',
                                     username=username)
            
            player_count = User.query.count()
            if player_count >= 4:
                return render_template('login.html',
                                     error=True,
                                     error_message='''<p>Partie complète! Maximum 4 joueurs.</p>
                                                    <a href="/">Retour</a>''')
            
            new_user = User(username=username)
            db.session.add(new_user)
            db.session.commit()
            session['username'] = username
            return redirect(url_for('lobby'))
    
    return render_template('login.html', error=False)

@app.route('/logout')
def logout():
    username = session.get('username')
    if username:
        with app.app_context():
            user = User.query.filter_by(username=username).first()
            if user and user.room:
                room_status = RoomStatus.query.filter_by(room_name=user.room).first()
                if room_status and room_status.assigned_player == username:
                    room_status.assigned_player = None
                    db.session.commit()
    
    session.pop('username', None)
    session.pop('room', None)
    return redirect(url_for('login'))

# NOUVEAU: Route pour réinitialiser complètement le jeu
@app.route('/reset_game', methods=['POST'])
def reset_game():
    """Réinitialise complètement le jeu et redirige tous les joueurs vers le lobby"""
    if 'username' not in session:
        return jsonify({'error': 'Not logged in'}), 401
    
    with app.app_context():
        # 1. Supprimer tous les messages de chat
        ChatMessage.query.delete()
        
        # 2. Réinitialiser tous les utilisateurs (déconnexion et remise à zéro)
        User.query.delete()
        
        # 3. Réinitialiser les états du jeu
        GameState.query.delete()
        initial_states = {
            'energy_level': 50.0,
            'water_pollution': 30.0,
            'air_co2': 40.0,
            'air_o2': 60.0,
            'flora_health': 60.0
        }
        for key, value in initial_states.items():
            db.session.add(GameState(key=key, value=value))
        
        # 4. Réinitialiser les statuts des salles
        RoomStatus.query.delete()
        rooms = ['Energie', 'Eau', 'Air', 'Flore']
        for i, room in enumerate(rooms):
            db.session.add(RoomStatus(
                room_name=room,
                is_completed=False,
                is_locked=(i != 0)
            ))
        
        # 5. Réinitialiser les infos du jeu
        GameInfo.query.delete()
        db.session.add(GameInfo(key='game_started', value='false'))
        db.session.add(GameInfo(key='game_end_time', value=''))
        
        db.session.commit()
        
        # 6. Émettre un événement pour forcer tous les clients à se reconnecter
        # Note: On utilise 'room' au lieu de 'broadcast' pour Flask-SocketIO
        socketio.emit('game_reset', {
            'message': 'Le jeu a été réinitialisé. Redirection vers la page de connexion...'
        }, namespace='/')
        
        # 7. Supprimer la session de l'utilisateur actuel
        session.clear()
        
        return jsonify({'success': True, 'redirect': '/login'})
    

# AJOUT 1: Nouvelle route pour la page du code final
@app.route('/final_code')
def final_code():
    if 'username' not in session:
        return redirect(url_for('login'))
    
    with app.app_context():
        return render_template('final_code.html', username=session['username'])

# AJOUT 2: Nouvelle route pour la page de victoire
@app.route('/victory')
def victory():
    if 'username' not in session:
        return redirect(url_for('login'))
    
    with app.app_context():
        return render_template('victory.html', username=session['username'])

# AJOUT 3: API pour valider le code final
# MODIFICATION: API pour valider le code final avec broadcast
@app.route('/api/validate_final_code', methods=['POST'])
def validate_final_code():
    """Valide le code secret final et notifie tous les joueurs"""
    if 'username' not in session:
        return jsonify({'error': 'Not logged in'}), 401
    
    data = request.get_json()
    code = data.get('code', '').strip().upper()
    
    CORRECT_CODE = 'EPSI WORKSHOPS 2025'  # Le code secret
    
    with app.app_context():
        if code == CORRECT_CODE:
            # Marquer la partie comme gagnée
            game_result_info = GameInfo.query.filter_by(key='game_result').first()
            if not game_result_info:
                game_result_info = GameInfo(key='game_result', value='victory')
                db.session.add(game_result_info)
            else:
                game_result_info.value = 'victory'
            
            # Enregistrer qui a validé le code
            code_validator_info = GameInfo.query.filter_by(key='code_validator').first()
            if not code_validator_info:
                code_validator_info = GameInfo(key='code_validator', value=session['username'])
                db.session.add(code_validator_info)
            else:
                code_validator_info.value = session['username']
            
            db.session.commit()
            
            # Ajouter un message dans le chat
            victory_message = ChatMessage(
                username='Système',
                message=f'🎉🏆 {session["username"]} a validé le code secret ! VICTOIRE TOTALE ! 🏆🎉'
            )
            db.session.add(victory_message)
            db.session.commit()
            
            # IMPORTANT: Émettre l'événement de victoire à tous les joueurs via SocketIO
            socketio.emit('victory_achieved', {
                'validator': session['username'],
                'message': f'{session["username"]} a trouvé le code secret !'
            }, namespace='/')
            
            return jsonify({'success': True, 'message': 'Code correct!', 'redirect': '/victory'})
        else:
            return jsonify({'success': False, 'message': 'Code incorrect'})
        
# ==================== SOCKETIO EVENTS (Actions uniquement) ====================

@socketio.on('select_room')
def handle_select_room(data):
    with app.app_context():
        room_name = data['room']
        username = session.get('username')
        user = User.query.filter_by(username=username).first()
        room_status = RoomStatus.query.filter_by(room_name=room_name).first()
        
        if not user or not room_status:
            emit('error', {'message': 'Utilisateur ou salle invalide'})
            return
        
        if room_status.assigned_player and room_status.assigned_player != username:
            emit('error', {'message': 'Salle déjà occupée par ' + room_status.assigned_player})
            return
        
        if user.room and user.room != room_name:
            old_room_status = RoomStatus.query.filter_by(room_name=user.room).first()
            if old_room_status and old_room_status.assigned_player == username:
                old_room_status.assigned_player = None
        
        user.room = room_name
        user.is_ready = False
        room_status.assigned_player = username
        db.session.commit()
        
        emit('room_selected', {'room': room_name})

@socketio.on('player_ready')
def handle_player_ready():
    global timer_greenlet
    
    with app.app_context():
        username = session.get('username')
        user = User.query.filter_by(username=username).first()
        
        if not user:
            emit('error', {'message': 'Utilisateur non trouvé'})
            return
        
        if not user.room:
            emit('error', {'message': 'Vous devez d\'abord sélectionner une salle'})
            return
        
        room_status = RoomStatus.query.filter_by(room_name=user.room).first()
        if not room_status:
            emit('error', {'message': 'Salle invalide'})
            return
        
        user.is_ready = True
        db.session.commit()
        
        game_started_info = GameInfo.query.filter_by(key='game_started').first()
        game_started = game_started_info and game_started_info.value == 'true'
        
        if not game_started:
            all_users = User.query.all()
            ready_users = [u for u in all_users if u.is_ready and u.room]
            if len(ready_users) >= 2:
                game_started_info.value = 'true'
                db.session.commit()
                
                if timer_greenlet is None:
                    timer_greenlet = eventlet.spawn(start_timer)

@socketio.on('action')
def handle_action(data):
    with app.app_context():
        room = session.get('room')
        username = session.get('username')
        
        if not room:
            emit('error', {'message': 'Vous devez d\'abord sélectionner une salle'})
            return
        
        room_status = RoomStatus.query.filter_by(room_name=room).first()
        if not room_status:
            emit('error', {'message': 'Salle invalide'})
            return
        
        game_started_info = GameInfo.query.filter_by(key='game_started').first()
        game_started = game_started_info and game_started_info.value == 'true'
        
        if game_started and room_status.is_locked:
            emit('error', {'message': 'Salle verrouillée.'})
            return
        
        user = User.query.filter_by(username=username).first()
        if not user or user.room != room:
            emit('error', {'message': 'Vous n\'êtes pas dans cette salle'})
            return
        
        if room_status.assigned_player != username:
            emit('error', {'message': 'Cette salle est occupée par un autre joueur'})
            return
        
        # Traitement des actions par salle
        if room == 'Energie':
            if data['action'] == 'connect_cables':
                correct = data.get('correct', False)
                gs = GameState.query.filter_by(key='energy_level').first()
                if correct:
                    gs.value = min(100, gs.value + 10)
                    emit('feedback', {'message': 'Réseau stable!'})
                    air_gs = GameState.query.filter_by(key='air_co2').first()
                    air_gs.value = max(0, air_gs.value - 5)
                    
                    if gs.value >= 60:
                        room_status.is_completed = True
                        # Ajout du message spécifique pour la salle Énergie
                        message_text = f"🎉 Bravo !⚡ L'énigme de la salle Énergie a été résolue🔋 Le réseau électrique est stabilisé ⚙️"
                        new_message = ChatMessage(
                            username='Système',
                            message=message_text
                        )
                        db.session.add(new_message)


                        message_indice = ChatMessage(
                            username='Système',
                            message=" 💡 Indice 1 : — À l’EPSI, ce n’est pas qu’une salle de classe 🏫 — c’est un espace où l’on apprend 📚, crée 💻, expérimente 🔬 et collabore 🤝."
                        )
                        db.session.add(message_indice)

                        db.session.commit()
                        
                
                        emit('puzzle_completed', {'room': room})
                        unlock_next_room(room)
                else:
                    gs.value = max(0, gs.value - 5)
                    emit('feedback', {'message': 'Connexion incorrecte.'})
        
        elif room == 'Eau':
            gs = GameState.query.filter_by(key='water_pollution').first()
            
            if data['action'] == 'sort_waste':
                correct = data.get('correct', False)
                if correct:
                    gs.value = max(0, gs.value - 5)
                    emit('feedback', {'message': 'Bon tri ! Pureté augmentée.'})
                else:
                    gs.value = min(100, gs.value + 3)
                    emit('feedback', {'message': 'Mauvais tri. Pollution accrue.'})
            
            elif data['action'] == 'adjust_ph':
                ph = data.get('value')
                if ph is not None:
                    emit('feedback', {'message': f'pH ajusté à {ph:.1f}'})
            
            elif data['action'] == 'adjust_o2':
                o2 = data.get('value')
                if o2 is not None:
                    emit('feedback', {'message': f'O₂ ajusté à {o2:.1f} mg/L'})
            
            elif data['action'] == 'validate_chemical':
                ph = data.get('ph')
                o2 = data.get('o2')
                if ph is None or o2 is None:
                    emit('error', {'message': 'Valeurs manquantes'})
                    return
                ph_correct = abs(ph - 7.0) < 0.5
                o2_correct = abs(o2 - 8.0) < 0.5
                correct = ph_correct and o2_correct
                if correct:
                    gs.value = max(0, gs.value - 20)
                    emit('feedback', {'message': 'Équilibre chimique atteint !'})
                    flora_gs = GameState.query.filter_by(key='flora_health').first()
                    flora_gs.value = min(100, flora_gs.value + 10)
                    air_gs = GameState.query.filter_by(key='air_o2').first()
                    air_gs.value = min(100, air_gs.value + 5)
                else:
                    gs.value = min(100, gs.value + 5)
                    message = 'Déséquilibre: '
                    if not ph_correct:
                        message += 'pH incorrect '
                    if not o2_correct:
                        message += 'O₂ incorrect'
                    emit('feedback', {'message': message})
            
            elif data['action'] == 'complete_water':
                if gs.value <= 10:
                    room_status.is_completed = True
                    
                    message_text = f"🌊🎉 Bravo ! L'énigme de la salle Eau a été résolue ! 💧 L’eau est maintenant purifiée. 💦✨"
                    new_message = ChatMessage(
                        username='Système',
                        message=message_text
                    )
                    db.session.add(new_message)

                    message_indice = ChatMessage(
                            username='Système',
                            message=" 💡 Indice 2 : 🎯 Chaque année, ces défis d’innovation 💡 rassemblent les étudiants 👩‍💻👨‍💻 autour de projets concrets 🔧, dans un esprit d’équipe 🤝 et de passion pour le code 🧠💻"
                        )
                    db.session.add(message_indice)

                    db.session.commit()
                    emit('puzzle_completed', {'room': room})
                    unlock_next_room(room)
                else:
                    emit('error', {'message': 'Pollution encore trop élevée'})
        
        elif room == 'Air':
            if data['action'] == 'identify_pollution_source':
                source = data.get('source')
                correct = data.get('correct', False)
                attempts = data.get('attempts', 1)
                
                co2_gs = GameState.query.filter_by(key='air_co2').first()
                o2_gs = GameState.query.filter_by(key='air_o2').first()
                
                if correct:
                    co2_gs.value = max(0, co2_gs.value - 30)
                    o2_gs.value = min(100, o2_gs.value + 20)
                    emit('feedback', {'message': '✅ Source identifiée ! Filtres activés.'})
                    
                    flora_gs = GameState.query.filter_by(key='flora_health').first()
                    flora_gs.value = min(100, flora_gs.value + 15)
                    
                    if co2_gs.value <= 30 and o2_gs.value >= 70:
                        room_status.is_completed = True
                        message_text = f"🎯🎉 Bravo ! 🌬️ L'énigme de la salle Air a été résolue ! 🍃 La qualité de l'air est maintenant rétablie 🌿✨"
                        new_message = ChatMessage(
                            username='Système',
                            message=message_text
                        )
                        db.session.add(new_message)

                        message_indice = ChatMessage(
                            username='Système',
                            message=" 💡 Indice 3 : ✨ Et cette fois, tout se joue dans une année symbolique 🗓️ : celle où la créativité 🎨 et la technologie 🤖 se rencontrent — 2025 🚀"
                        )
                        db.session.add(message_indice)

                        # AJOUT: Message de redirection
                        redirect_message = ChatMessage(
                            username='Système',
                            message="🔐 Tous les joueurs sont redirigés vers la validation du CODE FINAL ! Utilisez vos 3 indices pour le trouver ! 🔑"
                        )
                        db.session.add(redirect_message)

                        db.session.commit()
                        emit('puzzle_completed', {'room': room}, broadcast=True)
                        
                        # AJOUT: Rediriger tous les joueurs
                        emit('redirect_to_final', {}, broadcast=True)
        
        elif room == 'Flore':
            if data['action'] == 'select_plant':
                plant = data.get('plant')
                gs = GameState.query.filter_by(key='flora_health').first()
                if plant in ['oxygen_plant', 'purifying_plant']:
                    gs.value = min(100, gs.value + 10)
                    emit('feedback', {'message': f'Plante {plant} choisie!'})
                    air_gs = GameState.query.filter_by(key='air_o2').first()
                    air_gs.value = min(100, air_gs.value + 5)
                    
                    if gs.value >= 80:
                        room_status.is_completed = True
                        db.session.commit()
                        emit('puzzle_completed', {'room': room})
                        
                        all_completed = all(rs.is_completed for rs in RoomStatus.query.all())
                        if all_completed:
                            check_victory()
        
        db.session.commit()

if __name__ == '__main__':
    socketio.run(app, debug=True)