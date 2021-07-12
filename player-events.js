'use strict';

const { Broadcast: B, Config, Logger } = require('ranvier');
const sprintf = require('sprintf-js').sprintf;
const Combat = require('./libs/Combat');
const CombatErrors = require('./libs/CombatErrors');
const LevelUtil = require('./libs/LevelUtil');
const WebsocketStream = require('../websocket-networking/lib/WebsocketStream');

module.exports = {
  listeners: {
    /**
     * Handle a player movement command. From: 'commands' input event.
     * movementCommand is a result of CommandParser.parse
     */
    move: state => function (movementCommand) {
      const { roomExit } = movementCommand;

      if (!roomExit) {
        return B.sayAt(this, "這個方向沒有路喔!");
      }

      if (this.isInCombat()) {
        return B.sayAt(this, 'You are in the middle of a fight!');
      }

      const nextRoom = state.RoomManager.getRoom(roomExit.roomId);
      const oldRoom = this.room;

      const door = oldRoom.getDoor(nextRoom) || nextRoom.getDoor(oldRoom);

      if (door) {
        if (door.locked || door.closed) {
          return B.sayAt(this, "這個方向的門是關著的.");
        }
      }

      this.moveTo(nextRoom, _ => {
        state.CommandManager.get('look').execute('', this);
      });

      B.sayAt(oldRoom, `${this.name} leaves.`);
      B.sayAtExcept(nextRoom, `${this.name} enters.`, this);

      for (const follower of this.followers) {
        if (follower.room !== oldRoom) {
          continue;
        }

        if (follower.isNpc) {
          follower.moveTo(nextRoom);
        } else {
          B.sayAt(follower, `\r\nYou follow ${this.name} to ${nextRoom.title}.`);
          follower.emit('move', movementCommand);
        }
      }
    },

    save: state => async function (callback) {
      await state.PlayerManager.save(this);
      if (typeof callback === 'function') {
        callback();
      }
    },

    commandQueued: state => function (commandIndex) {
      const command = this.commandQueue.queue[commandIndex];
      const ttr = sprintf('%.1f', this.commandQueue.getTimeTilRun(commandIndex));
      B.sayAt(this, `<bold><yellow>Executing</yellow> '<white>${command.label}</white>' <yellow>in</yellow> <white>${ttr}</white> <yellow>seconds.</yellow>`);
    },

    updateTick: state => function () {
      if (this.commandQueue.hasPending && this.commandQueue.lagRemaining <= 0) {
        B.sayAt(this);
        this.commandQueue.execute();
        B.prompt(this);
      }
      const lastCommandTime = this._lastCommandTime || Infinity;
      const timeSinceLastCommand = Date.now() - lastCommandTime;
      const maxIdleTime = (Math.abs(Config.get('maxIdleTime')) * 60000) || Infinity;

      if (timeSinceLastCommand > maxIdleTime && !this.isInCombat()) {
        this.save(() => {
          B.sayAt(this, `You were kicked for being idle for more than ${maxIdleTime / 60000} minutes!`);
          B.sayAtExcept(this.room, `${this.name} disappears.`, this);
          Logger.log(`Kicked ${this.name} for being idle.`);
          state.PlayerManager.removePlayer(this, true);
        });
      }
    },

    /**
     * Handle player gaining experience
     * @param {number} amount Exp gained
     */
    experience: state => function (amount) {
      B.sayAt(this, `<blue>You gained <bold>${amount}</bold> experience!</blue>`);

      const totalTnl = LevelUtil.expToLevel(this.level + 1);

      // level up, currently wraps experience if they gain more than needed for multiple levels
      if (this.experience + amount > totalTnl) {
        B.sayAt(this, '                                   <bold><blue>!Level Up!</blue></bold>');
        B.sayAt(this, B.progress(80, 100, "blue"));

        let nextTnl = totalTnl;
        while (this.experience + amount > nextTnl) {
          amount = (this.experience + amount) - nextTnl;
          this.level++;
          this.experience = 0;
          nextTnl = LevelUtil.expToLevel(this.level + 1);
          B.sayAt(this, `<blue>You are now level <bold>${this.level}</bold>!</blue>`);
          this.emit('level');
        }
      }

      this.experience += amount;

      this.save();
    },

    // Quests Module
    questStart: state => function (quest) {
      B.sayAt(this, `\r\n<bold><yellow>Quest Started: ${quest.config.title}!</yellow></bold>`);
      if (quest.config.description) {
        B.sayAt(this, B.line(80));
        B.sayAt(this, `<bold><yellow>${quest.config.description}</yellow></bold>`, 80);
      }

      if (quest.config.rewards.length) {
        B.sayAt(this);
        B.sayAt(this, '<b><yellow>' + B.center(80, 'Rewards') + '</yellow></b>');
        B.sayAt(this, '<b><yellow>' + B.center(80, '-------') + '</yellow></b>');

        for (const reward of quest.config.rewards) {
          const rewardClass = state.QuestRewardManager.get(reward.type);
          B.sayAt(this, '  ' + rewardClass.display(state, quest, reward.config, this));
        }
      }

      B.sayAt(this, B.line(80));
    },

    questProgress: state => function (quest, progress) {
      B.sayAt(this, `\r\n<bold><yellow>${progress.display}</yellow></bold>`);
    },

    questTurnInReady: state => function (quest) {
      B.sayAt(this, `<bold><yellow>${quest.config.title} ready to turn in!</yellow></bold>`);
    },

    questComplete: state => function (quest) {
      B.sayAt(this, `<bold><yellow>Quest Complete: ${quest.config.title}!</yellow></bold>`);

      if (quest.config.completionMessage) {
        B.sayAt(this, B.line(80));
        B.sayAt(this, quest.config.completionMessage);
      }
    },

    /**
     * Player received a quest reward
     * @param {object} reward Reward config _not_ an instance of QuestReward
     */
    questReward: state => function (reward) {
      // do stuff when the player receives a quest reward. Generally the Reward instance
      // will emit an event that will be handled elsewhere and display its own message
      // e.g., 'currency' or 'experience'. But if you want to handle that all in one
      // place instead, or you'd like to show some supplemental message you can do that here
    },

    // Classes
    useAbility: state => function (ability, args) {
      if (!this.playerClass.hasAbility(ability.id)) {
        return B.sayAt(this, 'Your class cannot use that ability.');
      }

      if (!this.playerClass.canUseAbility(this, ability.id)) {
        return B.sayAt(this, 'You have not yet learned that ability.');
      }

      let target = null;
      if (ability.requiresTarget) {
        if (!args || !args.length) {
          if (ability.targetSelf) {
            target = this;
          } else if (this.isInCombat()) {
            target = [...this.combatants][0];
          } else {
            target = null;
          }
        } else {
          try {
            const targetSearch = args.split(' ').pop();
            target = Combat.findCombatant(this, targetSearch);
          } catch (e) {
            if (
              e instanceof CombatErrors.CombatSelfError ||
              e instanceof CombatErrors.CombatNonPvpError ||
              e instanceof CombatErrors.CombatInvalidTargetError ||
              e instanceof CombatErrors.CombatPacifistError
            ) {
              return B.sayAt(this, e.message);
            }

            Logger.error(e.message);
          }
        }

        if (!target) {
          return B.sayAt(this, `Use ${ability.name} on whom?`);
        }
      }

      try {
        ability.execute(args, this, target);
      } catch (e) {
        if (e instanceof SkillErrors.CooldownError) {
          if (ability.cooldownGroup) {
            return B.sayAt(this, `Cannot use ${ability.name} while ${e.effect.skill.name} is on cooldown.`);
          }
          return B.sayAt(this, `${ability.name} is on cooldown. ${humanize(e.effect.remaining)} remaining.`);
        }

        if (e instanceof SkillErrors.PassiveError) {
          return B.sayAt(this, `That skill is passive.`);
        }

        if (e instanceof SkillErrors.NotEnoughResourcesError) {
          return B.sayAt(this, `You do not have enough resources.`);
        }

        Logger.error(e.message);
        B.sayAt(this, 'Huh?');
      }
    },

    /**
     * Handle player leveling up
     */
    level: state => function () {
      const abilities = this.playerClass.abilityTable;
      if (!(this.level in this.playerClass.abilityTable)) {
        return;
      }

      const newSkills = abilities[this.level].skills || [];
      for (const abilityId of newSkills) {
        const skill = state.SkillManager.get(abilityId);
        B.sayAt(this, `<bold><yellow>You can now use skill: ${skill.name}.</yellow></bold>`);
        skill.activate(this);
      }

      const newSpells = abilities[this.level].spells || [];
      for (const abilityId of newSpells) {
        const spell = state.SpellManager.get(abilityId);
        B.sayAt(this, `<bold><yellow>You can now use spell: ${spell.name}.</yellow></bold>`);
      }
    },

    // Fight System
    updateTick: state => function () {
      Combat.startRegeneration(state, this);

      let hadActions = false;
      try {
        hadActions = Combat.updateRound(state, this);
      } catch (e) {
        if (e instanceof CombatErrors.CombatInvalidTargetError) {
          B.sayAt(this, "You can't attack that target.");
        } else {
          throw e;
        }
      }

      if (!hadActions) {
        return;
      }

      const usingWebsockets = this.socket instanceof WebsocketStream;
      // don't show the combat prompt to a websockets server
      if (!this.hasPrompt('combat') && !usingWebsockets) {
        this.addPrompt('combat', _ => promptBuilder(this));
      }

      B.sayAt(this, '');
      if (!usingWebsockets) {
        B.prompt(this);
      }
    },

    /**
     * When the player hits a target
     * @param {Damage} damage
     * @param {Character} target
     */
    hit: state => function (damage, target, finalAmount) {
      if (damage.metadata.hidden) {
        return;
      }

      let buf = '';
      if (damage.source !== this) {
        buf = `Your <b>${damage.source.name}</b> hit`;
      } else {
        buf = "You hit";
      }

      buf += ` <b>${target.name}</b> for <b>${finalAmount}</b> damage.`;

      if (damage.metadata.critical) {
        buf += ' <red><b>(Critical)</b></red>';
      }

      B.sayAt(this, buf);

      if (this.equipment.has('wield')) {
        this.equipment.get('wield').emit('hit', damage, target, finalAmount);
      }

      // show damage to party members
      if (!this.party) {
        return;
      }

      for (const member of this.party) {
        if (member === this || member.room !== this.room) {
          continue;
        }

        let buf = '';
        if (damage.source !== this) {
          buf = `${this.name} <b>${damage.source.name}</b> hit`;
        } else {
          buf = `${this.name} hit`;
        }

        buf += ` <b>${target.name}</b> for <b>${finalAmount}</b> damage.`;
        B.sayAt(member, buf);
      }
    },

    /**
     * @param {Heal} heal
     * @param {Character} target
     */
    heal: state => function (heal, target) {
      if (heal.metadata.hidden) {
        return;
      }

      if (target !== this) {
        let buf = '';
        if (heal.source !== this) {
          buf = `Your <b>${heal.source.name}</b> healed`;
        } else {
          buf = "You heal";
        }

        buf += `<b> ${target.name}</b> for <b><green>${finalAmount}</green></b> ${heal.attribute}.`;
        B.sayAt(this, buf);
      }

      // show heals to party members
      if (!this.party) {
        return;
      }

      for (const member of this.party) {
        if (member === this || member.room !== this.room) {
          continue;
        }

        let buf = '';
        if (heal.source !== this) {
          buf = `${this.name} <b>${heal.source.name}</b> healed`;
        } else {
          buf = `${this.name} healed`;
        }

        buf += ` <b>${target.name}</b>`;
        buf += ` for <b><green>${finalAmount}</green></b> ${heal.attribute}.`;
        B.sayAt(member, buf);
      }
    },

    damaged: state => function (damage, finalAmount) {
      if (damage.metadata.hidden || damage.attribute !== 'health') {
        return;
      }

      let buf = '';
      if (damage.attacker) {
        buf = `<b>${damage.attacker.name}</b>`;
      }

      if (damage.source !== damage.attacker) {
        buf += (damage.attacker ? "'s " : " ") + `<b>${damage.source.name}</b>`;
      } else if (!damage.attacker) {
        buf += "Something";
      }

      buf += ` hit <b>You</b> for <b><red>${finalAmount}</red></b> damage.`;

      if (damage.metadata.critical) {
        buf += ' <red><b>(Critical)</b></red>';
      }

      B.sayAt(this, buf);

      if (this.party) {
        // show damage to party members
        for (const member of this.party) {
          if (member === this || member.room !== this.room) {
            continue;
          }

          let buf = '';
          if (damage.attacker) {
            buf = `<b>${damage.attacker.name}</b>`;
          }

          if (damage.source !== damage.attacker) {
            buf += (damage.attacker ? "'s " : ' ') + `<b>${damage.source.name}</b>`;
          } else if (!damage.attacker) {
            buf += "Something";
          }

          buf += ` hit <b>${this.name}</b> for <b><red>${finalAmount}</red></b> damage`;
          B.sayAt(member, buf);
        }
      }

      if (this.getAttribute('health') <= 0) {
        Combat.handleDeath(state, this, damage.attacker);
      }
    },

    healed: state => function (heal, finalAmount) {
      if (heal.metadata.hidden) {
        return;
      }

      let buf = '';
      let attacker = '';
      let source = '';

      if (heal.attacker && heal.attacker !== this) {
        attacker = `<b>${heal.attacker.name}</b> `;
      }

      if (heal.source !== heal.attacker) {
        attacker = attacker ? attacker + "'s " : '';
        source = `<b>${heal.source.name}</b>`;
      } else if (!heal.attacker) {
        source = "Something";
      }

      if (heal.attribute === 'health') {
        buf = `${attacker}${source} heals you for <b><red>${finalAmount}</red></b>.`;
      } else {
        buf = `${attacker}${source} restores <b>${finalAmount}</b> ${heal.attribute}.`;
      }
      B.sayAt(this, buf);

      // show heal to party members only if it's to health and not restoring a different pool
      if (!this.party || heal.attribute !== 'health') {
        return;
      }

      for (const member of this.party) {
        if (member === this || member.room !== this.room) {
          continue;
        }

        let buf = `${attacker}${source} heals ${this.name} for <b><red>${finalAmount}</red></b>.`;
        B.sayAt(member, buf);
      }
    },

    /**
     * Player was killed
     * @param {Character} killer
     */
     killed: state => {
       const startingRoomRef = Config.get('startingRoom');
       if (!startingRoomRef) {
         Logger.error('No startingRoom defined in ranvier.json');
       }

       return function (killer) {
        this.removePrompt('combat');

        const othersDeathMessage = killer ?
          `<b><red>${this.name} collapses to the ground, dead at the hands of ${killer.name}.</b></red>` :
          `<b><red>${this.name} collapses to the ground, dead</b></red>`;

        B.sayAtExcept(this.room, othersDeathMessage, (killer ? [killer, this] : this));

        if (this.party) {
          B.sayAt(this.party, `<b><green>${this.name} was killed!</green></b>`);
        }

        this.setAttributeToMax('health');

        let home = state.RoomManager.getRoom(this.getMeta('waypoint.home'));
        if (!home) {
          home = state.RoomManager.getRoom(startingRoomRef);
        }

        this.moveTo(home, _ => {
          state.CommandManager.get('look').execute(null, this);

          B.sayAt(this, '<b><red>Whoops, that sucked!</red></b>');
          if (killer && killer !== this) {
            B.sayAt(this, `You were killed by ${killer.name}.`);
          }
          // player loses 20% exp gained this level on death
          const lostExp = Math.floor(this.experience * 0.2);
          this.experience -= lostExp;
          this.save();
          B.sayAt(this, `<red>You lose <b>${lostExp}</b> experience!</red>`);

          B.prompt(this);
        });
      };
    },

    /**
     * Player killed a target
     * @param {Character} target
     */
    deathblow: state => function (target, skipParty) {
      const xp = LevelUtil.mobExp(target.level);
      if (this.party && !skipParty) {
        // if they're in a party proxy the deathblow to all members of the party in the same room.
        // this will make sure party members get quest credit trigger anything else listening for deathblow
        for (const member of this.party) {
          if (member.room === this.room) {
            member.emit('deathblow', target, true);
          }
        }
        return;
      }

      if (target && !this.isNpc) {
        B.sayAt(this, `<b><red>You killed ${target.name}!</red></b>`);
      }

      this.emit('experience', xp);
    },

    currency: state => function (currency, amount) {
      const friendlyName = currency.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
      const key = `currencies.${currency}`;

      if (!this.getMeta('currencies')) {
        this.setMeta('currencies', {});
      }
      this.setMeta(key, (this.getMeta(key) || 0) + amount);
      this.save();

      B.sayAt(this, `<green>你獲得了金錢: <b><white>[${friendlyName}]</white></b> x${amount}.`);
    },
  }
};


function promptBuilder(promptee) {
  if (!promptee.isInCombat()) {
    return '';
  }

  // Set up some constants for formatting the health bars
  const playerName = "You";
  const targetNameLengths = [...promptee.combatants].map(t => t.name.length);
  const nameWidth = Math.max(playerName.length, ...targetNameLengths);
  const progWidth = 60 - (nameWidth + ':  ').length;

  // Set up helper functions for health-bar-building.
  const getHealthPercentage = entity => Math.floor((entity.getAttribute('health') / entity.getMaxAttribute('health')) * 100);
  const formatProgressBar = (name, progress, entity) => {
    const pad = B.line(nameWidth - name.length, ' ');
    return `<b>${name}${pad}</b>: ${progress} <b>${entity.getAttribute('health')}/${entity.getMaxAttribute('health')}</b>`;
  }

  // Build player health bar.
  let currentPerc = getHealthPercentage(promptee);
  let progress = B.progress(progWidth, currentPerc, "green");
  let buf = formatProgressBar(playerName, progress, promptee);

  // Build and add target health bars.
  for (const target of promptee.combatants) {
    let currentPerc = Math.floor((target.getAttribute('health') / target.getMaxAttribute('health')) * 100);
    let progress = B.progress(progWidth, currentPerc, "red");
    buf += `\r\n${formatProgressBar(target.name, progress, target)}`;
  }

  return buf;
}
