'use strict';

/**
 * Scenarios are revealed only after every credit has been spent.
 *
 * Deliberately short: one line of setup, three stakes. The table does the
 * talking, so the screen only has to land the premise in about five seconds.
 * If a scenario has one obvious correct answer, it is a bad scenario.
 */

const SCENARIOS = [
  { id: 'zombie', title: 'The Outbreak', emoji: '\u{1F9DF}',
    setup: 'Something is spreading. Get out of the city and set up somewhere that survives the winter.',
    stakes: ['Getting out alive', 'Food, water, power', 'Not turning on each other'] },

  { id: 'ipo', title: 'The IPO', emoji: '\u{1F4C8}',
    setup: 'Your five are the whole company. Eleven weeks to listing and a journalist is circling.',
    stakes: ['Convincing the money', 'Surviving due diligence', 'Killing the story'] },

  { id: 'mars', title: 'The Mars Transit', emoji: '\u{1F680}',
    setup: 'Nine months in a tube, two years on the surface. Your five are the entire crew.',
    stakes: ['Keeping the hardware alive', 'Keeping each other sane', 'Improvising repairs'] },

  { id: 'trial', title: 'The Murder Trial', emoji: '⚖️',
    setup: 'You are on trial for something you did not do. Your five are the whole defence.',
    stakes: ['Breaking the case', 'Finding what really happened', 'Winning twelve strangers'] },

  { id: 'heist', title: 'The Vault', emoji: '\u{1F48E}',
    setup: 'One building, one night, one object. Your five are the entire crew.',
    stakes: ['Getting in', 'Getting the thing', 'Nobody talking after'] },

  { id: 'island', title: 'The Island', emoji: '\u{1F3DD}',
    setup: 'The boat is gone. Rescue is a year away, if it comes.',
    stakes: ['Surviving week one', 'Building something better', 'Morale with no exit'] },

  { id: 'election', title: 'The Campaign', emoji: '\u{1F5F3}\uFE0F',
    setup: 'Six weeks out, fourteen points down. One of your five has to be the candidate.',
    stakes: ['Moving opinion fast', 'Surviving the dirt', 'Ground game with no money'] },

  { id: 'restaurant', title: 'Opening Night', emoji: '\u{1F37D}',
    setup: 'Eight weeks to open in a city that eats restaurants. The critic has already booked.',
    stakes: ['Food worth the price', 'A room that runs itself', 'Getting anyone through the door'] },

  { id: 'submarine', title: 'The Deep Dive', emoji: '\u{1F6A2}',
    setup: 'Four hundred metres down, comms cut, something is leaking.',
    stakes: ['Fixing it with what is aboard', 'Rationing air', 'Deciding who gives orders'] },

  { id: 'cult', title: 'The Extraction', emoji: '\u{1F441}\uFE0F',
    setup: 'Get someone out of a compound. She does not want to leave.',
    stakes: ['Getting inside', 'Changing one mind', 'Leaving unfollowed'] },

  { id: 'pandemic', title: 'The Ward', emoji: '\u{1F3E5}',
    setup: 'A hospital with failing power, no supply chain and four hundred patients. You run it now.',
    stakes: ['Triage at scale', 'Supplies that never come', 'Staff past breaking'] },

  { id: 'festival', title: 'The Festival', emoji: '\u{1F3AA}',
    setup: 'Ninety thousand people, one field. Two headliners just cancelled and the weather turned.',
    stakes: ['Crowd safety', 'Filling the lineup', 'Not getting sued'] },

  { id: 'firstcontact', title: 'First Contact', emoji: '\u{1F6F8}',
    setup: 'Something landed. It is patient. Your five were the closest qualified humans.',
    stakes: ['Communicating at all', 'Not starting a war', 'Eight billion frightened people'] },

  { id: 'blackout', title: 'The Blackout', emoji: '\u{1F50C}',
    setup: 'Grid down across three states, day nine. Your five run a neighbourhood of eleven thousand.',
    stakes: ['Water, heat, food', 'Order without police', 'A plan for months of this'] },

  { id: 'boardroom', title: 'The Takeover', emoji: '\u{1F454}',
    setup: 'A raider holds 31% and the board votes in nine days. Your five are the defence.',
    stakes: ['Winning the vote', 'Finding leverage', 'Keeping the story straight'] },

  { id: 'kidnap', title: 'The Ransom', emoji: '\u{1F4DE}',
    setup: 'Someone has been taken abroad. You have a phone number and a deadline.',
    stakes: ['Keeping the line open', 'Finding where they are', 'Paying, or not'] },

  { id: 'antarctic', title: 'The Winterover', emoji: '\u{1F9CA}',
    setup: 'Eight months of dark at an isolated station. No flights until spring, whatever happens.',
    stakes: ['Machinery that must not fail', 'The same five faces', 'No medical evacuation'] },

  { id: 'documentary', title: 'The Exposé', emoji: '\u{1F3A5}',
    setup: 'Eleven weeks to prove a very rich man did a very bad thing. His lawyers know your names.',
    stakes: ['Terrified sources', 'Evidence that survives legal', 'Publishing before you are stopped'] },
];

module.exports = { SCENARIOS };
