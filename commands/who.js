'use strict';

const { Broadcast: B } = require('ranvier');

module.exports = {
  usage: 'who',
  command: (state) => (args, player) => {
    B.sayAt(player, "<white>────────────────────────────────────────</white>");
    B.sayAt(player, "<bold><yellow>目前在線上的玩家有:</yellow></bold>");
    B.sayAt(player, '');

    state.PlayerManager.players.forEach((otherPlayer) => {
      B.sayAt(player, ` *  ${otherPlayer.name} ${getRoleString(otherPlayer.role)}`);
    });

    B.sayAt(player, "<white>────────────────────────────────────────</white>");
    B.sayAt(player, `<yellow>共有 ${state.PlayerManager.players.size} 名玩家在遊戲中</yellow>`);

    function getRoleString(role = 0) {
      return [
        '',
        '<white>[Builder]</white>',
        '<b><white>[Admin]</white></b>'
      ][role] || '';
    }
  }
};


