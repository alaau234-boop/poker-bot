import { InlineKeyboardMarkup } from 'telegraf/types';

export const mainMenuMarkup: InlineKeyboardMarkup = {
  inline_keyboard: [[{ text: 'Main Menu', callback_data: 'main_menu' }]],
};
