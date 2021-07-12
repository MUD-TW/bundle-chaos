'use strict';

const { Broadcast } = require('ranvier');

module.exports = {
  command : state => (args, player) => {
    // match cast "fireball" target
    const match = args.match(/^(['"])([^\1]+)+\1(?:$|\s+(.+)$)/);
    if (!match) {
      return Broadcast.sayAt(player, "你要施放什麼法術? 目標是誰呢? e.g., cast 'fireball' target");
    }

    const [ , , spellName, targetArgs] = match;
    const spell = state.SpellManager.find(spellName);

    if (!spell) {
      return Broadcast.sayAt(player, "歷史上根本沒有關於這項法術的記載!");
    }

    player.queueCommand({
      execute: _ => {
        player.emit('useAbility', spell, targetArgs);
      },
      label: `cast ${args}`,
    }, spell.lag || state.Config.get('skillLag') || 1000);
  }
};
