import { parseDoublePrecise } from "@/utils/math";
import { Nullable } from "@/utils/types";

export interface IGameChartEvent {
  startTime: number,
  endTime: number,
  start: number,
  end: number,
}

export interface IGameChartEventSingle {
  startTime: number,
  endTime: number,
  value: number,
};

export class GameChartEvent implements IGameChartEvent {
  readonly startTime: number;
  readonly endTime: number;
  readonly start: number;
  readonly end: number;

  constructor(
    startTime: number,
    endTime: number,
    start: number,
    end: number,
    precision: Nullable<number> = null
  ) {
    this.startTime = startTime;
    this.endTime = endTime;
    this.start = precision !== null ? parseDoublePrecise(start, precision) : start;
    this.end = precision !== null ? parseDoublePrecise(end, precision) : end;
  }
}

export class GameChartEventSingle implements IGameChartEventSingle {
  readonly startTime: number;
  readonly endTime: number;
  readonly value: number;

  constructor(
    startTime: number,
    endTime: number,
    value: number,
    precision: Nullable<number> = null
  ) {
    this.startTime = startTime;
    this.endTime = endTime;
    this.value = precision !== null ? parseDoublePrecise(value, precision) : value;
  }
}
