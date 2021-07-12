'use strict';

const { Logger } = require('ranvier');
const CommonFunctions = require('../libs/CommonFunctions');

module.exports = {
  event: state => (socket, args) => {
    if (!args || !args.dontwelcome) {
      socket.write('請輸入帳號名稱: ');
    }

    socket.once('data', async name => {
      name = name.toString().trim();

      const invalid = CommonFunctions.validateName(name);
      if (invalid) {
        socket.write(invalid + '\r\n');
        return socket.emit('login', socket);
      }

      name = name[0].toUpperCase() + name.slice(1);

      let account = null;
      try {
        account = await state.AccountManager.loadAccount(name);
      } catch (e) {
        Logger.error(e.message);
      }

      if (!account) {
        Logger.error(`帳號名稱 ${name} 不存在.`);
        return socket.emit('create-account', socket, name);
      }

      if (account.banned) {
        socket.write('這個帳號已被禁止.\r\n');
        socket.end();
        return;
      }

      if (account.deleted) {
        socket.write('這個帳號已被刪除.\r\n');
        socket.end();
        return;
      }

      return socket.emit('password', socket, { dontwelcome: false, account });
    });
  }
};
