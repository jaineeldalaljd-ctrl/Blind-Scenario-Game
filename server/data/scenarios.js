'use strict';

/**
 * Scenarios are revealed only after every credit has been spent.
 *
 * `stakes` lines are the judging prompt -- they exist to give the pitch phase
 * something to argue against, and they are written so that no single archetype
 * is an automatic win. If a scenario has one obvious correct answer, it is a
 * bad scenario.
 */

const SCENARIOS = [
  {
    id: 'zombie',
    title: 'The Outbreak',
    emoji: '\u{1F9DF}',
    setup: 'Something is spreading and it is not slowing down. Your five have 72 hours to get out of the city and set up somewhere that can last a winter.',
    stakes: ['Getting out alive', 'Food, water and power that lasts', 'Not turning on each other by week three'],
  },
  {
    id: 'ipo',
    title: 'The IPO',
    emoji: '\u{1F4C8}',
    setup: 'Your five are the entire company. You are eleven weeks from listing, the numbers are fine but not great, and a journalist is circling.',
    stakes: ['Convincing institutional money', 'Surviving due diligence', 'Killing the story before it runs'],
  },
  {
    id: 'mars',
    title: 'The Mars Transit',
    emoji: '\u{1F680}',
    setup: 'Nine months in a tube, then two years on the surface. Your five are the entire crew. Resupply is theoretical.',
    stakes: ['Keeping the hardware alive', 'Keeping each other sane', 'Improvising when something breaks that should not'],
  },
  {
    id: 'trial',
    title: 'The Murder Trial',
    emoji: '⚖',
    setup: 'You are on trial for something you did not do. Your five are your entire defence team. The evidence looks bad.',
    stakes: ['Dismantling the prosecution case', 'Finding what actually happened', 'Winning twelve strangers over'],
  },
  {
    id: 'heist',
    title: 'The Vault',
    emoji: '\u{1F48E}',
    setup: 'One building, one night, one object. Your five are the whole crew and the security was designed by people who assumed a crew like yours.',
    stakes: ['Getting in', 'Getting the thing', 'Getting out without anybody talking afterwards'],
  },
  {
    id: 'island',
    title: 'The Island',
    emoji: '\u{1F3DD}',
    setup: 'The boat is gone. The island has fresh water somewhere and nothing else. Rescue is not coming for at least a year.',
    stakes: ['Not dying in week one', 'Building something that improves', 'Group morale with no exit'],
  },
  {
    id: 'election',
    title: 'The Campaign',
    emoji: '\u{1F5F3}',
    setup: 'Six weeks out, fourteen points down, and one of you has to be the candidate. Your five are the entire operation.',
    stakes: ['Moving public opinion fast', 'Surviving opposition research', 'Ground game with no money'],
  },
  {
    id: 'restaurant',
    title: 'Opening Night',
    emoji: '\u{1F37D}',
    setup: 'Your five are opening a restaurant in eight weeks in a city that eats restaurants. The critic has already booked, anonymously.',
    stakes: ['Food that justifies the price', 'A room that runs itself', 'Getting people through the door at all'],
  },
  {
    id: 'submarine',
    title: 'The Deep Dive',
    emoji: '\u{1F6A2}',
    setup: 'Four hundred metres down, comms cut ninety minutes ago and something is leaking. Your five are everyone aboard.',
    stakes: ['Fixing it with what is on board', 'Rationing air and nerves', 'Deciding who gives the orders'],
  },
  {
    id: 'cult',
    title: 'The Extraction',
    emoji: '\u{1F441}',
    setup: 'A family has paid you to get their daughter out of a compound. She does not want to leave. There are two hundred people inside who like it there.',
    stakes: ['Getting inside without force', 'Changing one person’s mind', 'Leaving before anyone follows'],
  },
  {
    id: 'pandemic',
    title: 'The Ward',
    emoji: '\u{1F3E5}',
    setup: 'A regional hospital, power intermittent, supply chain broken, four hundred patients. Your five are running it as of this morning.',
    stakes: ['Triage at scale', 'Supplies that are not coming', 'Staff who are past breaking'],
  },
  {
    id: 'festival',
    title: 'The Festival',
    emoji: '\u{1F3AA}',
    setup: 'Ninety thousand people, three days, one field. Two headliners just cancelled and the forecast turned. Your five are the entire production office.',
    stakes: ['Crowd safety when it turns', 'Filling the hole in the lineup', 'Not being sued into the ground'],
  },
  {
    id: 'firstcontact',
    title: 'First Contact',
    emoji: '\u{1F6F8}',
    setup: 'Something landed. It is patient, it is not hostile yet, and your five were the closest qualified humans. The world is watching the live feed.',
    stakes: ['Communicating at all', 'Not starting a war by accident', 'Managing eight billion frightened people'],
  },
  {
    id: 'blackout',
    title: 'The Blackout',
    emoji: '\u{1F50C}',
    setup: 'The grid is down across three states, day nine, and it is not being fixed quickly. Your five run one neighbourhood of eleven thousand people.',
    stakes: ['Water, heat and food', 'Order without police', 'A plan for when it lasts months'],
  },
  {
    id: 'boardroom',
    title: 'The Hostile Takeover',
    emoji: '\u{1F454}',
    setup: 'A raider has 31% and a board vote in nine days. Your five are the defence. The founder is a liability and will not leave.',
    stakes: ['Winning the shareholder vote', 'Finding leverage on the raider', 'Keeping the story straight in public'],
  },
  {
    id: 'kidnap',
    title: 'The Ransom',
    emoji: '\u{1F4DE}',
    setup: 'Someone has been taken abroad. Local authorities are compromised. Your five have a phone number, a deadline and no jurisdiction.',
    stakes: ['Keeping the line open', 'Working out where they actually are', 'Paying, or not paying, correctly'],
  },
  {
    id: 'antarctic',
    title: 'The Winterover',
    emoji: '\u{1F9CA}',
    setup: 'Eight months of dark at an isolated station. No flights in or out until spring, whatever happens. Your five are the entire crew.',
    stakes: ['Machinery that must not fail', 'Six months of the same faces', 'Medical emergencies with no evacuation'],
  },
  {
    id: 'documentary',
    title: 'The Exposé',
    emoji: '\u{1F3A5}',
    setup: 'You have eleven weeks to prove a very rich man did a very bad thing. His lawyers already know your names.',
    stakes: ['Sources who are terrified', 'Evidence that survives legal', 'Publishing before you are shut down'],
  },
];

module.exports = { SCENARIOS };
