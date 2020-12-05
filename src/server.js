const app = require('express')();
const server = require('http').Server(app);
const io = require('socket.io')(server);
const Player = require('./player');
const Match = require('./match');

let players = [];
let unmatchedPlayers = [];
let matches = [];

app.get('/', (req, res) => {
    res.send('TIC TAC ONLINE');
});

server.listen(80, () => {
    //console.log('Server is now running...');
});

io.on('connection', (socket) => {
    //console.log('Player requested to join...');

    // First dispatch the current status of matches and online players
    socket.emit('game.status.changed', { players: players.length, matches: matches.length });

    // When the player is ready, send the id and current list of unmatched players
    socket.on('player.ready', () => {
        socket.emit('player.connect', { id: socket.id, unmatched: unmatchedPlayers });
    });

    // Players may leave but doesn't necessarily want to disconnect immediately.
    // We simply remove the player from the list of players and unmatched players, they can join again when ready
    socket.on('player.leave', () => {
        //console.log(socket.id + ' left');

        removePlayer(socket.id);
        removeUnmatchedPlayer(socket.id);
        
        // Notify all players that a player left
        socket.broadcast.emit('player.left', socket.id);
    });

    // Listen to a join request from the player 
    socket.on('player.join', playerName => {
        //console.log('players: ' + players.length);
        //console.log('unmatched: ' + unmatchedPlayers.length);

        if (!playerName || getPlayer(socket.id))
            return;

        const player = new Player(socket);
        player.socket = socket;

        if (getPlayerWithName(playerName))
            player.name = playerName + ' (' + socket.id.substring(0, 3) + Math.trunc(Math.random() * 10) + ')';
        else
            player.name = playerName;
        players.push(player);

        // Send the updated status
        dispatchGameStatChangedEvent();

        // Welcome the new player
        socket.emit('player.welcome');

        // Notify all players that a new player joined
        socket.broadcast.emit('player.joined', { id: socket.id, playerName: player.name});

        // Add this player to the list of unmatched players
        unmatchedPlayers.push(getSerializablePlayerObject(player));
        //console.log('Player joined: ' + socket.id + '(' + player.name + ')');
    });

    // Listen to a match request from this player
    socket.on('player.match', opponentId => {
        // First, make sure this player is unmatched
        const player = getPlayer(socket.id);
        if (!getUnmatchedPlayer(socket.id) || !player)
            return;

        //console.log('Requesting a match with: ' + opponentId);

        // Get the opponent
        const opponent = getPlayer(opponentId);
        if (getUnmatchedPlayer(opponentId) && opponent) {
            // Send a match request to the opponent
            opponent.socket.emit('player.match.request', { id: player.id, playerName: player.name });

            const acceptMatchListener = data => {
                // Confirm that the ID matches
                if (data.id !== player.id)
                    return;

                // Match the players
                const player1 = player;
                const player2 = opponent;
                player1.opponent = player2;
                player2.opponent = player1;
                let turn = '';

                if (Math.random() > 0.5 && Math.random() < 0.5) {
                    player1.jelly = 'j1';
                    player2.jelly = 'j2';
                    turn = player2.id;
                }
                else {
                    player1.jelly = 'j2';
                    player2.jelly = 'j1';
                    turn = player1.id;
                }

                const match = new Match(player1, player2);
                match.turn = turn;
                matches.push(match);
                
                // Send the updated status
                dispatchGameStatChangedEvent();

                // Start the match
                player1.socket.emit('player.match.start', {
                    ...getSerializablePlayerObject(player1),
                    matchId: match.id,
                    turn: match.turn,
                    opponent: getSerializablePlayerObject(player2),
                });

                player2.socket.emit('player.match.start', {
                    ...getSerializablePlayerObject(player2),
                    matchId: match.id,
                    turn: match.turn,
                    opponent: getSerializablePlayerObject(player1),
                });

                // Remove the players from unmatched players list
                removeUnmatchedPlayer(player1.id);
                removeUnmatchedPlayer(player2.id);

                // Notify all players about the matching
                io.emit('player.matched', player1.id);
                io.emit('player.matched', player2.id);

                // Once either player disconnects, end the match
                player1.socket.on('disconnect', () => {
                    player2.socket.emit('player.match.opponent-disconnected');

                    // The game is over, end the match
                    endMatch(match, player2);
                });
                player2.socket.on('disconnect', () => {
                    player1.socket.emit('player.match.opponent-disconnected');

                    // The game is over, end the match
                    endMatch(match, player1);
                });

                // We also need to remove the event listener for when the challenge is declined
                opponent.socket.removeListener('player.match.decline', declineMatchListener);

                //console.log('Match started for: ' + player1.id + ' and ' + player2.id);
            };

            const declineMatchListener = data => {
                // Confirm that the ID matches
                if (data.id !== player.id)
                    return;

                //console.log('declined!');

                // notify the challenger
                player.socket.emit('player.match.opponent-declined', opponent.name);

                // We also need to remove the event listener for when the challenge is accepted
                opponent.socket.removeListener('player.match.accept', acceptMatchListener);
            };

            // If the player accepts the request, let's start the match
            opponent.socket.once('player.match.accept', acceptMatchListener);

            // If the player decline the request, let's notify the challenger
            opponent.socket.once('player.match.decline', declineMatchListener);
        }
        else {
            // Opponent is either matched, disconnected or the provided id is invalid
            if (!opponent) {
                socket.emit('player.match.opponent-not-found', opponentId);
                removeUnmatchedPlayer(playerId);
            }
            else {
                socket.emit('player.match.opponent-matched', opponentId);
                removeUnmatchedPlayer(playerId);
            }
        }
    });

    // Listen to moves made
    socket.on('player.move.make', data => {
        //console.log('making a move');

        // Make sure the match id passed is valid
        const match = getMatch(data.matchId);
        //console.log('match found: ' + match ? true : false);
        if (!match)
            return;

        // Make sure a valid move is passed
        if (!data.move)
            return;
        
        //console.log('turn: ' + match.turn + ', id: ' + socket.id);
        // Make sure it is the player's turn
        if (match.turn !== socket.id)
            return;

        // Make the move
        const player = getPlayer(socket.id);
        if (match.makeMove(player, data.move)) {
            // Notify the players that a move was made
            const moveData = {
                jelly: player.jelly,
                move: data.move,
                turn: match.turn,
            };

            match.player1.socket.emit('player.move.made', moveData);
            match.player2.socket.emit('player.move.made', moveData);

            //console.log('Move made!');

            // Check game over conditions
            let winningPlayer = null;

            if (match.isPlayerWon(player)) {
                winningPlayer = player;
            }
            else if (match.isPlayerWon(player.opponent)) {
                winningPlayer = player.opponent;
            }

            if (winningPlayer) {
                // A player won; dispatch the message
                match.player1.socket.emit('player.match.won', winningPlayer.id);
                match.player2.socket.emit('player.match.won', winningPlayer.id);

                // The game is over, end the match
                endMatch(match);

                //console.log('matches: ' + matches.length);
            }
            else {
                // Let's check if the game is over (board is filled up). In that case, it is a draw
                if (match.isGameOver()) {
                    // Dispatch the message
                    match.player1.socket.emit('player.match.draw');
                    match.player2.socket.emit('player.match.draw');

                    // The game is over, end the match
                    endMatch(match);
                }
            }
        }
    });

    // Listen for forfeiture
    socket.on('player.match.forfeit', matchId => {
        // Make sure the match id passed is valid
        const match = getMatch(matchId);
        if (!match)
            return;

       // Dispatch the message
       match.player1.socket.emit('player.match.forfeited', socket.id);
       match.player2.socket.emit('player.match.forfeited', socket.id);

       // The game is over, end the match
       endMatch(match);
    });

    socket.on('disconnect', () => {
        removePlayer(socket.id);
        removeUnmatchedPlayer(socket.id);
        
        // Notify all players that a player left
        socket.broadcast.emit('player.left', socket.id);

        //console.log('Player disconnected: ' + socket.id);
    });
});

const dispatchGameStatChangedEvent = () => {
    io.emit('game.status.changed', { players: players.length, matches: matches.length });
};

const getUnmatchedPlayer = playerId => {
    for (let i = 0; i < unmatchedPlayers.length; i++) {
        if (unmatchedPlayers[i].id === playerId)
            return unmatchedPlayers[i];
    }

    return null;
};

const getPlayer = playerId => {
    for (let i = 0; i < players.length; i++) {
        if (players[i].id === playerId)
            return players[i];
    }

    return null;
};

const getPlayerWithName = playerName => {
    for (let i = 0; i < players.length; i++) {
        if (players[i].name === playerName)
            return players[i];
    }

    return null;
};

const getMatch = matchId => {
    for (let i = 0; i < matches.length; i++) {
        if (matches[i].id === matchId)
            return matches[i];
    }

    return null;
};

const removeUnmatchedPlayer = playerId => {
    unmatchedPlayers = unmatchedPlayers.filter(player => player.id !== playerId);
};

const removePlayer = playerId => {
    players = players.filter(player => player.id !== playerId);

    // Send the updated status
    dispatchGameStatChangedEvent();
};

const removeMatch = matchId => {
    matches = matches.filter(match => match.id !== matchId);

    // Send the updated status
    dispatchGameStatChangedEvent();
};

const endMatch = (match, activePlayer = null) => {
    // remove the match
    removeMatch(match.id);

    // notify others that these players are now availaible for matching.
    // we could create another event type for this but for simplicity, let's use the player.joined event
    if (!activePlayer) {
        match.player1.socket.broadcast
            .emit('player.joined', { id: match.player1.id, playerName: match.player1.name});
        match.player2.socket.broadcast
            .emit('player.joined', { id: match.player2.id, playerName: match.player2.name});
    }
    else {
        activePlayer.socket.broadcast
            .emit('player.joined', { id: activePlayer.id, playerName: activePlayer.name});
    }

    // Make the players availaible for matching
    if (!activePlayer) {
        unmatchedPlayers.push(getSerializablePlayerObject(match.player1));
        unmatchedPlayers.push(getSerializablePlayerObject(match.player2));
    }
    else {
        unmatchedPlayers.push(getSerializablePlayerObject(activePlayer));
    }
};

const getSerializablePlayerObject = player => {
    return {...player, socket: '', opponent: ''};
};
