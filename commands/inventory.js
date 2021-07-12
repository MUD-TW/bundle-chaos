'use strict';

const { Broadcast } = require('ranvier');
const ItemUtil = require('../libs/ItemUtil');

module.exports = {
  usage: 'inventory',
  command : (state) => (args, player) => {
    if (!player.inventory || !player.inventory.size) {
      return Broadcast.sayAt(player, "You aren't carrying anything.");
    }

    Broadcast.at(player, "你身上目前攜帶著有");
    if (isFinite(player.inventory.getMax())) {
      Broadcast.at(player, ` (${player.inventory.size}/${player.inventory.getMax()})`);
    }
    Broadcast.sayAt(player, ':');

    // TODO: Implement grouping
    for (const [, item ] of player.inventory) {
      Broadcast.sayAt(player, `     ${ItemUtil.display(item)}`);
    }
  }
};
