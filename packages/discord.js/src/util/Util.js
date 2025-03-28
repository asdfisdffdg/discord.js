'use strict';

const { parse } = require('node:path');
const { Collection } = require('@discordjs/collection');
const { ChannelType, RouteBases, Routes, GuildFeature } = require('discord-api-types/v10');
const { fetch } = require('undici');
const Colors = require('./Colors');
const { Error: DiscordError, RangeError, TypeError } = require('../errors');
const isObject = d => typeof d === 'object' && d !== null;

/**
 * Contains various general-purpose utility methods.
 */
class Util extends null {
  /**
   * Flatten an object. Any properties that are collections will get converted to an array of keys.
   * @param {Object} obj The object to flatten.
   * @param {...Object<string, boolean|string>} [props] Specific properties to include/exclude.
   * @returns {Object}
   */
  static flatten(obj, ...props) {
    if (!isObject(obj)) return obj;

    const objProps = Object.keys(obj)
      .filter(k => !k.startsWith('_'))
      .map(k => ({ [k]: true }));

    props = objProps.length ? Object.assign(...objProps, ...props) : Object.assign({}, ...props);

    const out = {};

    for (let [prop, newProp] of Object.entries(props)) {
      if (!newProp) continue;
      newProp = newProp === true ? prop : newProp;

      const element = obj[prop];
      const elemIsObj = isObject(element);
      const valueOf = elemIsObj && typeof element.valueOf === 'function' ? element.valueOf() : null;
      const hasToJSON = elemIsObj && typeof element.toJSON === 'function';

      // If it's a Collection, make the array of keys
      if (element instanceof Collection) out[newProp] = Array.from(element.keys());
      // If the valueOf is a Collection, use its array of keys
      else if (valueOf instanceof Collection) out[newProp] = Array.from(valueOf.keys());
      // If it's an array, call toJSON function on each element if present, otherwise flatten each element
      else if (Array.isArray(element)) out[newProp] = element.map(e => e.toJSON?.() ?? Util.flatten(e));
      // If it's an object with a primitive `valueOf`, use that value
      else if (typeof valueOf !== 'object') out[newProp] = valueOf;
      // If it's an object with a toJSON function, use the return value of it
      else if (hasToJSON) out[newProp] = element.toJSON();
      // If element is an object, use the flattened version of it
      else if (typeof element === 'object') out[newProp] = Util.flatten(element);
      // If it's a primitive
      else if (!elemIsObj) out[newProp] = element;
    }

    return out;
  }

  /**
   * Options used to escape markdown.
   * @typedef {Object} EscapeMarkdownOptions
   * @property {boolean} [codeBlock=true] Whether to escape code blocks or not
   * @property {boolean} [inlineCode=true] Whether to escape inline code or not
   * @property {boolean} [bold=true] Whether to escape bolds or not
   * @property {boolean} [italic=true] Whether to escape italics or not
   * @property {boolean} [underline=true] Whether to escape underlines or not
   * @property {boolean} [strikethrough=true] Whether to escape strikethroughs or not
   * @property {boolean} [spoiler=true] Whether to escape spoilers or not
   * @property {boolean} [codeBlockContent=true] Whether to escape text inside code blocks or not
   * @property {boolean} [inlineCodeContent=true] Whether to escape text inside inline code or not
   */

  /**
   * Escapes any Discord-flavour markdown in a string.
   * @param {string} text Content to escape
   * @param {EscapeMarkdownOptions} [options={}] Options for escaping the markdown
   * @returns {string}
   */
  static escapeMarkdown(
    text,
    {
      codeBlock = true,
      inlineCode = true,
      bold = true,
      italic = true,
      underline = true,
      strikethrough = true,
      spoiler = true,
      codeBlockContent = true,
      inlineCodeContent = true,
    } = {},
  ) {
    if (!codeBlockContent) {
      return text
        .split('```')
        .map((subString, index, array) => {
          if (index % 2 && index !== array.length - 1) return subString;
          return Util.escapeMarkdown(subString, {
            inlineCode,
            bold,
            italic,
            underline,
            strikethrough,
            spoiler,
            inlineCodeContent,
          });
        })
        .join(codeBlock ? '\\`\\`\\`' : '```');
    }
    if (!inlineCodeContent) {
      return text
        .split(/(?<=^|[^`])`(?=[^`]|$)/g)
        .map((subString, index, array) => {
          if (index % 2 && index !== array.length - 1) return subString;
          return Util.escapeMarkdown(subString, {
            codeBlock,
            bold,
            italic,
            underline,
            strikethrough,
            spoiler,
          });
        })
        .join(inlineCode ? '\\`' : '`');
    }
    if (inlineCode) text = Util.escapeInlineCode(text);
    if (codeBlock) text = Util.escapeCodeBlock(text);
    if (italic) text = Util.escapeItalic(text);
    if (bold) text = Util.escapeBold(text);
    if (underline) text = Util.escapeUnderline(text);
    if (strikethrough) text = Util.escapeStrikethrough(text);
    if (spoiler) text = Util.escapeSpoiler(text);
    return text;
  }

  /**
   * Escapes code block markdown in a string.
   * @param {string} text Content to escape
   * @returns {string}
   */
  static escapeCodeBlock(text) {
    return text.replaceAll('```', '\\`\\`\\`');
  }

  /**
   * Escapes inline code markdown in a string.
   * @param {string} text Content to escape
   * @returns {string}
   */
  static escapeInlineCode(text) {
    return text.replace(/(?<=^|[^`])``?(?=[^`]|$)/g, match => (match.length === 2 ? '\\`\\`' : '\\`'));
  }

  /**
   * Escapes italic markdown in a string.
   * @param {string} text Content to escape
   * @returns {string}
   */
  static escapeItalic(text) {
    let i = 0;
    text = text.replace(/(?<=^|[^*])\*([^*]|\*\*|$)/g, (_, match) => {
      if (match === '**') return ++i % 2 ? `\\*${match}` : `${match}\\*`;
      return `\\*${match}`;
    });
    i = 0;
    return text.replace(/(?<=^|[^_])_([^_]|__|$)/g, (_, match) => {
      if (match === '__') return ++i % 2 ? `\\_${match}` : `${match}\\_`;
      return `\\_${match}`;
    });
  }

  /**
   * Escapes bold markdown in a string.
   * @param {string} text Content to escape
   * @returns {string}
   */
  static escapeBold(text) {
    let i = 0;
    return text.replace(/\*\*(\*)?/g, (_, match) => {
      if (match) return ++i % 2 ? `${match}\\*\\*` : `\\*\\*${match}`;
      return '\\*\\*';
    });
  }

  /**
   * Escapes underline markdown in a string.
   * @param {string} text Content to escape
   * @returns {string}
   */
  static escapeUnderline(text) {
    let i = 0;
    return text.replace(/__(_)?/g, (_, match) => {
      if (match) return ++i % 2 ? `${match}\\_\\_` : `\\_\\_${match}`;
      return '\\_\\_';
    });
  }

  /**
   * Escapes strikethrough markdown in a string.
   * @param {string} text Content to escape
   * @returns {string}
   */
  static escapeStrikethrough(text) {
    return text.replaceAll('~~', '\\~\\~');
  }

  /**
   * Escapes spoiler markdown in a string.
   * @param {string} text Content to escape
   * @returns {string}
   */
  static escapeSpoiler(text) {
    return text.replaceAll('||', '\\|\\|');
  }

  /**
   * @typedef {Object} FetchRecommendedShardsOptions
   * @property {number} [guildsPerShard=1000] Number of guilds assigned per shard
   * @property {number} [multipleOf=1] The multiple the shard count should round up to. (16 for large bot sharding)
   */

  /**
   * Gets the recommended shard count from Discord.
   * @param {string} token Discord auth token
   * @param {FetchRecommendedShardsOptions} [options] Options for fetching the recommended shard count
   * @returns {Promise<number>} The recommended number of shards
   */
  static async fetchRecommendedShards(token, { guildsPerShard = 1_000, multipleOf = 1 } = {}) {
    if (!token) throw new DiscordError('TOKEN_MISSING');
    const response = await fetch(RouteBases.api + Routes.gatewayBot(), {
      method: 'GET',
      headers: { Authorization: `Bot ${token.replace(/^Bot\s*/i, '')}` },
    });
    if (!response.ok) {
      if (response.status === 401) throw new DiscordError('TOKEN_INVALID');
      throw response;
    }
    const { shards } = await response.json();
    return Math.ceil((shards * (1_000 / guildsPerShard)) / multipleOf) * multipleOf;
  }

  /**
   * Parses emoji info out of a string. The string must be one of:
   * * A UTF-8 emoji (no id)
   * * A URL-encoded UTF-8 emoji (no id)
   * * A Discord custom emoji (`<:name:id>` or `<a:name:id>`)
   * @param {string} text Emoji string to parse
   * @returns {APIEmoji} Object with `animated`, `name`, and `id` properties
   * @private
   */
  static parseEmoji(text) {
    if (text.includes('%')) text = decodeURIComponent(text);
    if (!text.includes(':')) return { animated: false, name: text, id: undefined };
    const match = text.match(/<?(?:(a):)?(\w{2,32}):(\d{17,19})?>?/);
    return match && { animated: Boolean(match[1]), name: match[2], id: match[3] };
  }

  /**
   * Resolves a partial emoji object from an {@link EmojiIdentifierResolvable}, without checking a Client.
   * @param {EmojiIdentifierResolvable} emoji Emoji identifier to resolve
   * @returns {?RawEmoji}
   * @private
   */
  static resolvePartialEmoji(emoji) {
    if (!emoji) return null;
    if (typeof emoji === 'string') return /^\d{17,19}$/.test(emoji) ? { id: emoji } : Util.parseEmoji(emoji);
    const { id, name, animated } = emoji;
    if (!id && !name) return null;
    return { id, name, animated: Boolean(animated) };
  }

  /**
   * Shallow-copies an object with its class/prototype intact.
   * @param {Object} obj Object to clone
   * @returns {Object}
   * @private
   */
  static cloneObject(obj) {
    return Object.assign(Object.create(obj), obj);
  }

  /**
   * Sets default properties on an object that aren't already specified.
   * @param {Object} def Default properties
   * @param {Object} given Object to assign defaults to
   * @returns {Object}
   * @private
   */
  static mergeDefault(def, given) {
    if (!given) return def;
    for (const key in def) {
      if (!Object.hasOwn(given, key) || given[key] === undefined) {
        given[key] = def[key];
      } else if (given[key] === Object(given[key])) {
        given[key] = Util.mergeDefault(def[key], given[key]);
      }
    }

    return given;
  }

  /**
   * Options used to make an error object.
   * @typedef {Object} MakeErrorOptions
   * @property {string} name Error type
   * @property {string} message Message for the error
   * @property {string} stack Stack for the error
   */

  /**
   * Makes an Error from a plain info object.
   * @param {MakeErrorOptions} obj Error info
   * @returns {Error}
   * @private
   */
  static makeError(obj) {
    const err = new Error(obj.message);
    err.name = obj.name;
    err.stack = obj.stack;
    return err;
  }

  /**
   * Makes a plain error info object from an Error.
   * @param {Error} err Error to get info from
   * @returns {MakeErrorOptions}
   * @private
   */
  static makePlainError(err) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }

  /**
   * Moves an element in an array *in place*.
   * @param {Array<*>} array Array to modify
   * @param {*} element Element to move
   * @param {number} newIndex Index or offset to move the element to
   * @param {boolean} [offset=false] Move the element by an offset amount rather than to a set index
   * @returns {number}
   * @private
   */
  static moveElementInArray(array, element, newIndex, offset = false) {
    const index = array.indexOf(element);
    newIndex = (offset ? index : 0) + newIndex;
    if (newIndex > -1 && newIndex < array.length) {
      const removedElement = array.splice(index, 1)[0];
      array.splice(newIndex, 0, removedElement);
    }
    return array.indexOf(element);
  }

  /**
   * Verifies the provided data is a string, otherwise throws provided error.
   * @param {string} data The string resolvable to resolve
   * @param {Function} [error] The Error constructor to instantiate. Defaults to Error
   * @param {string} [errorMessage] The error message to throw with. Defaults to "Expected string, got <data> instead."
   * @param {boolean} [allowEmpty=true] Whether an empty string should be allowed
   * @returns {string}
   */
  static verifyString(
    data,
    error = Error,
    errorMessage = `Expected a string, got ${data} instead.`,
    allowEmpty = true,
  ) {
    if (typeof data !== 'string') throw new error(errorMessage);
    if (!allowEmpty && data.length === 0) throw new error(errorMessage);
    return data;
  }

  /**
   * Can be a number, hex string, an RGB array like:
   * ```js
   * [255, 0, 255] // purple
   * ```
   * or one of the following strings:
   * - `Default`
   * - `White`
   * - `Aqua`
   * - `Green`
   * - `Blue`
   * - `Yellow`
   * - `Purple`
   * - `LuminousVividPink`
   * - `Fuchsia`
   * - `Gold`
   * - `Orange`
   * - `Red`
   * - `Grey`
   * - `Navy`
   * - `DarkAqua`
   * - `DarkGreen`
   * - `DarkBlue`
   * - `DarkPurple`
   * - `DarkVividPink`
   * - `DarkGold`
   * - `DarkOrange`
   * - `DarkRed`
   * - `DarkGrey`
   * - `DarkerGrey`
   * - `LightGrey`
   * - `DarkNavy`
   * - `Blurple`
   * - `Greyple`
   * - `DarkButNotBlack`
   * - `NotQuiteBlack`
   * - `Random`
   * @typedef {string|number|number[]} ColorResolvable
   */

  /**
   * Resolves a ColorResolvable into a color number.
   * @param {ColorResolvable} color Color to resolve
   * @returns {number} A color
   */
  static resolveColor(color) {
    if (typeof color === 'string') {
      if (color === 'Random') return Math.floor(Math.random() * (0xffffff + 1));
      if (color === 'Default') return 0;
      color = Colors[color] ?? parseInt(color.replace('#', ''), 16);
    } else if (Array.isArray(color)) {
      color = (color[0] << 16) + (color[1] << 8) + color[2];
    }

    if (color < 0 || color > 0xffffff) throw new RangeError('COLOR_RANGE');
    else if (Number.isNaN(color)) throw new TypeError('COLOR_CONVERT');

    return color;
  }

  /**
   * Sorts by Discord's position and id.
   * @param {Collection} collection Collection of objects to sort
   * @returns {Collection}
   */
  static discordSort(collection) {
    const isGuildChannel = collection.first() instanceof GuildChannel;
    return collection.sorted(
      isGuildChannel
        ? (a, b) => a.rawPosition - b.rawPosition || Number(BigInt(a.id) - BigInt(b.id))
        : (a, b) => a.rawPosition - b.rawPosition || Number(BigInt(b.id) - BigInt(a.id)),
    );
  }

  /**
   * Sets the position of a Channel or Role.
   * @param {Channel|Role} item Object to set the position of
   * @param {number} position New position for the object
   * @param {boolean} relative Whether `position` is relative to its current position
   * @param {Collection<string, Channel|Role>} sorted A collection of the objects sorted properly
   * @param {Client} client The client to use to patch the data
   * @param {string} route Route to call PATCH on
   * @param {string} [reason] Reason for the change
   * @returns {Promise<Channel[]|Role[]>} Updated item list, with `id` and `position` properties
   * @private
   */
  static async setPosition(item, position, relative, sorted, client, route, reason) {
    let updatedItems = [...sorted.values()];
    Util.moveElementInArray(updatedItems, item, position, relative);
    updatedItems = updatedItems.map((r, i) => ({ id: r.id, position: i }));
    await client.rest.patch(route, { body: updatedItems, reason });
    return updatedItems;
  }

  /**
   * Alternative to Node's `path.basename`, removing query string after the extension if it exists.
   * @param {string} path Path to get the basename of
   * @param {string} [ext] File extension to remove
   * @returns {string} Basename of the path
   * @private
   */
  static basename(path, ext) {
    const res = parse(path);
    return ext && res.ext.startsWith(ext) ? res.name : res.base.split('?')[0];
  }
  /**
   * The content to have all mentions replaced by the equivalent text.
   * @param {string} str The string to be converted
   * @param {TextBasedChannels} channel The channel the string was sent in
   * @returns {string}
   */
  static cleanContent(str, channel) {
    str = str
      .replace(/<@!?[0-9]+>/g, input => {
        const id = input.replace(/<|!|>|@/g, '');
        if (channel.type === ChannelType.DM) {
          const user = channel.client.users.cache.get(id);
          return user ? `@${user.username}` : input;
        }

        const member = channel.guild.members.cache.get(id);
        if (member) {
          return `@${member.displayName}`;
        } else {
          const user = channel.client.users.cache.get(id);
          return user ? `@${user.username}` : input;
        }
      })
      .replace(/<#[0-9]+>/g, input => {
        const mentionedChannel = channel.client.channels.cache.get(input.replace(/<|#|>/g, ''));
        return mentionedChannel ? `#${mentionedChannel.name}` : input;
      })
      .replace(/<@&[0-9]+>/g, input => {
        if (channel.type === ChannelType.DM) return input;
        const role = channel.guild.roles.cache.get(input.replace(/<|@|>|&/g, ''));
        return role ? `@${role.name}` : input;
      });
    return str;
  }

  /**
   * The content to put in a code block with all code block fences replaced by the equivalent backticks.
   * @param {string} text The string to be converted
   * @returns {string}
   */
  static cleanCodeBlockContent(text) {
    return text.replaceAll('```', '`\u200b``');
  }

  /**
   * Resolves the maximum time a guild's thread channels should automatcally archive in case of no recent activity.
   * @param {Guild} guild The guild to resolve this limit from.
   * @returns {number}
   */
  static resolveAutoArchiveMaxLimit({ features }) {
    if (features.includes(GuildFeature.SevenDayThreadArchive)) return 10080;
    if (features.includes(GuildFeature.ThreeDayThreadArchive)) return 4320;
    return 1440;
  }
}

module.exports = Util;

// Fixes Circular
const GuildChannel = require('../structures/GuildChannel');
