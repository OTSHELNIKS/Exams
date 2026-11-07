import { test } from 'node:test'
import assert from 'node:assert/strict'
import { telegramBotUsername } from '../app/src/telegram-config.js'

test('uses production bot unless a valid public bot username is configured', () => {
  assert.equal(telegramBotUsername(undefined), 'name_mlbb_bot')
  assert.equal(telegramBotUsername(' Tester_mlbb_bot '), 'Tester_mlbb_bot')
  assert.equal(telegramBotUsername('@Tester_mlbb_bot'), 'Tester_mlbb_bot')
  for (const invalid of ['https://t.me/evil_bot', 'evil_bot?start=abc', 'hello', 'evil bot', 'xbot', 'a'.repeat(33) + 'bot', null]) {
    assert.equal(telegramBotUsername(invalid), 'name_mlbb_bot')
  }
})
