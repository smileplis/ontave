import {ApplicationDefinition} from '../../src/application.js';
import data from './definition.json' with {type: 'json'};
/** Fictional reference application, separate from the domain-neutral framework. */
export function exampleApplication() { return ApplicationDefinition.parse(data); }
