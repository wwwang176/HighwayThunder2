/** The cars picked before a race: the player's, and each rival's (car type ids, src/vehicles/cars). */
export interface CarSelection {
  player: string;
  rivals: string[];
}
