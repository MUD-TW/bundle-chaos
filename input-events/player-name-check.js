'use strict';

const { EventUtil } = require('ranvier');

/**
 * Confirm new player name
 */
module.exports = {
  event: state => (socket, args) => {
    const say = EventUtil.genSay(socket);
    const write  = EventUtil.genWrite(socket);

    write(`<bold>角色名稱 ${args.name} 尚未有人使用，你確定要創建角色？</bold> <cyan>[y/n]</cyan> `);
    socket.once('data', confirmation => {
      say('');
      confirmation = confirmation.toString().trim().toLowerCase();

      if (!/[yn]/.test(confirmation)) {
        return socket.emit('player-name-check', socket, args);
      }

      if (confirmation === 'n') {
        say(`Let's try again...`);
        return socket.emit('create-player', socket, args);
      }

      socket.emit('choose-class', socket, args);
    });
  }
};
