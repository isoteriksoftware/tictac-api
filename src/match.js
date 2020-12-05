class Match {
    constructor(player1, player2) {
        this.player1 = player1;
        this.player2 = player2;
        this.id = player1.id + player2.id;
        this.turn = player1.id;

        this.clearBoard();
    }

    makeMove(player, move) {
        move = move.split('|');
        const row = move[0];
        const col = move[1];

        if (this.board[row][col] !== '')
            return false;

        this.board[row][col] = player.jelly;

        if (player.id === this.player1.id)
            this.turn = this.player2.id;
        else
            this.turn = this.player1.id;

        return true;
    }

    isPlayerWon(player) {
        const winCombos = [
            this.board[0][0] + this.board[0][1] + this.board[0][2],
            this.board[1][0] + this.board[1][1] + this.board[1][2],
            this.board[2][0] + this.board[2][1] + this.board[2][2],
            this.board[0][0] + this.board[1][1] + this.board[2][2],
            this.board[0][0] + this.board[1][0] + this.board[2][0],
            this.board[0][1] + this.board[1][1] + this.board[2][1],
            this.board[0][2] + this.board[1][2] + this.board[2][2],
            this.board[2][0] + this.board[1][1] + this.board[0][2]
        ];

        const match = player.jelly + player.jelly + player.jelly;
        
        for (let i = 0; i < winCombos.length; i++) {
            if (winCombos[i] === match)
                return true;
        }

        return false;
    }

    isGameOver() {
        for (let i = 0; i < this.board.length; i++) {
            for (let j = 0; j < this.board.length; j++) {
                if (this.board[i][j] === '')
                    return false;
            }
        }

        return true;
    }

    clearBoard() {
        this.board = [
            ['', '', ''],
            ['', '', ''],
            ['', '', ''],
        ];
    }
}

module.exports = Match;