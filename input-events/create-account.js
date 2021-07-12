'use strict';

const { Account, EventUtil } = require('ranvier');

/**
 * Account creation event
 */
module.exports = {
  event: (state) => (socket, name) => {
    const write = EventUtil.genWrite(socket);
    const say = EventUtil.genSay(socket);

    let newAccount = null;
    write(`<bold>你確定要使用 ${name} 作為帳號?</bold> <cyan>[y/n]</cyan> `);

    socket.once('data', data => {
      data = data.toString('utf8').trim();

      data = data.toLowerCase();
      if (data === 'y' || data === 'yes') {
        say('創建帳號……');
        newAccount = new Account({
          username: name
        });

        return socket.emit('change-password', socket, {
          account: newAccount,
          nextStage: 'create-player'
        });
      } else if (data && data === 'n' || data === 'no') {
        say("在試一次！");

        return socket.emit('login', socket);
      }

      return socket.emit('create-account', socket, name);
    });
  }
};
