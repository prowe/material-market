import Chance from 'chance';
import { stringify } from 'csv-stringify/sync';

const chance = new Chance();
const materials = [
    'wheat',
    'wood',
    'stone',
    'coal',
    'oil',
    'iron-ore',
    'corn',
    'soybeans'
];

const orders = chance.n(() => ({
    type: chance.pickone(['Buy', 'Sell']),
    material: chance.pickone(materials),
    quantity: chance.natural({min: 1, max: 100}),
    pricePerUnit: chance.natural({min: 1, max: 500})
}), 100);

console.log(stringify(orders, {
    header: false
}));
