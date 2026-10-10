/**
 * Message Model Badge — browser half.
 *
 * One entry in the assistant message's action strip
 * (`conversation.chat.assistant-actions`), ordered after the shipped feedback
 * pair. It renders the `provider/model` this package's host half projected for
 * the message it was given — nothing else.
 *
 * How many badges you see: the host renders that slot from exactly one place,
 * the Turn tail (`dsh-client-ui-chat`), keyed by the turn's *closing* assistant
 * message. So a turn with several assistant messages — tool calls, retries —
 * gets one badge, on the message that carries the action row. That is the whole
 * surface; there is nowhere else to put one.
 *
 * The strip composes `[clock?] [copy] [extraActions] [branch] [usage] [time]`,
 * so the label lands beside the other message actions rather than after the
 * timestamp; putting it after the timestamp would mean shadowing host markup.
 * The strip is hover-revealed for non-closing turns, so the label follows the
 * same rule as the controls next to it.
 *
 * Styling is copied from the row's own stylesheet and expressed in theme tokens,
 * so it reads as secondary metadata exactly like the usage and time text beside
 * it, and survives a rename of the host class names.
 *
 * Written in the client loader's own format, so there is no build step: this
 * file is the shipped artifact.
 *
 * @module dsh-plugin-message-model-badge/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-message-model-badge',
  factory(require) {
    const React = require('react')

    const h = React.createElement

    /** Mirrors `PROJECTION_KEY` in this package's host half. */
    const PROJECTION_KEY = 'messageModel'

    /**
     * The host row's own typography for secondary metadata
     * (`MessageIconActions.module.css`: `.timeEnd` / `.endInfo`). Every variable
     * carries the host's fallback, so a renamed app variable degrades to the same
     * literal the host itself would use.
     */
    const style = {
      fontSize: 'calc(var(--dsh-content-font-size-secondary, 13px) - 1px)',
      lineHeight: 'calc(24px + var(--dsh-content-font-delta, 0px))',
      color: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))',
      whiteSpace: 'nowrap',
    }

    /**
     * The provider/model that produced one assistant message.
     * @param props.messageId - the message the action row belongs to (owner share).
     * @param props.useProjection - the Client projection reader (standard prop).
     * @returns the label, or null when the host projected nothing for it.
     */
    function MessageModelBadge({ messageId, useProjection }) {
      const projection = useProjection(PROJECTION_KEY)
      // `models` is exact but windowed; `single` covers a Session that has only
      // ever used one model, and is deliberately null once it has used two — an
      // absent label beats a wrong one.
      const label = projection?.models?.[messageId] ?? projection?.single ?? null
      if (typeof label !== 'string' || label.length === 0) return null
      return h('span', { title: label, style }, label)
    }

    /** Client services this plugin needs before it can register anything. */
    const inject = ['slots']

    /**
     * Register the one entry.
     * @param ctx - client root context.
     */
    function apply(ctx) {
      ctx.slots.inject('conversation.chat.assistant-actions', () =>
        ctx.slots.register(
          {
            name: 'conversation.chat.assistant-actions',
            // The package's own name: no shipped entry can collide with it.
            id: 'dsh-plugin-message-model-badge',
            order: 20,
          },
          MessageModelBadge,
        ),
      )
    }

    return { inject, apply }
  },
})
