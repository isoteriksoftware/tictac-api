class Player {
    constructor(socket) {
        this.id = socket.id;
        this.jelly = '';
        this.opponent = null;
        this.socket = socket;
        this.name = '';
    }
}

module.exports = Player;