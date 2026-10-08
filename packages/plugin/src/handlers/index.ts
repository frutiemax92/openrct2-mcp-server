import type { Job } from "../queue";
import * as build from "./build";
import * as mapH from "./map";
import * as misc from "./misc";
import * as parkH from "./park";
import * as ratings from "./ratings";
import * as ride from "./ride";
import * as session from "./session";
import * as staff from "./staff";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
/** Tâche exécutée au début de la frame suivante, hors file. `changesMap` : elle charge un parc (voir main.ts). */
export type Defer = (fn: () => void, options?: { changesMap?: boolean }) => void;

export type Handler = (params: any, deferred: Defer) => Job;

export const handlers: Record<string, Handler> = {
    "session.info": session.info,
    "session.set_paused": session.setPaused,
    "session.cheats.get": session.cheatsGet,
    "session.cheats.set": session.cheatsSet,
    "session.ping": session.ping,
    "park.overview": parkH.overview,
    "park.set": parkH.set,
    "park.entrance_place": parkH.entrancePlace,
    "park.spawn_place": parkH.spawnPlace,
    "map.size": mapH.size,
    "map.region": mapH.region,
    "map.tile": mapH.tile,
    "map.ownership.set": parkH.ownershipSet,
    "terrain.set_heights": build.setHeights,
    "terrain.set_surface": build.setSurface,
    "terrain.set_water": build.setWater,
    "path.place_tiles": build.pathPlace,
    "path.remove_tiles": build.pathRemove,
    "path.place_addition": build.pathAddition,
    "path.remove_addition": build.pathAdditionRemove,
    "ride.list": ride.list,
    "ride.get": ride.get,
    "ride.create": ride.create,
    "ride.place_track": ride.placeTrack,
    "ride.place_entrance_exit": ride.placeEntranceExit,
    "ride.set_status": ride.setStatus,
    "ride.set_price": ride.setPrice,
    "ride.set_setting": ride.setSetting,
    "ride.set_name": ride.setName,
    "ride.demolish": ride.demolish,
    "track.footprint": ride.footprint,
    "staff.hire": staff.hire,
    "staff.fire": staff.fire,
    "staff.set_orders": staff.setOrders,
    "staff.set_patrol": staff.setPatrol,
    "staff.list": staff.list,
    "track.segment": ride.segment,
    "track.segments": ride.segments,
    "track.circuit": ride.circuit,
    "track.rating_scan": ratings.scan,
    "ride.train": ratings.train,
    "scenery.place_small": build.placeSmall,
    "scenery.place_large": build.placeLarge,
    "scenery.place_wall": build.placeWall,
    "scenery.remove_small": build.removeSmall,
    "scenery.clear_region": build.clearRegion,
    "objects.list": misc.list,
    "objects.load": misc.load,
    "objects.unload": misc.unload,
    "capture.view": misc.capture,
    "checkpoint.save": misc.checkpointSave,
    "checkpoint.restore": misc.checkpointRestore,
    "time.status": misc.status,
    "time.run": misc.run,
    "batch.execute": misc.batch,
};

/** Délai propre à certaines méthodes (ms). */
export function timeoutFor(method: string, params: { ticks?: number; speed?: number }): number | undefined {
    if (method === "time.run" && typeof params?.ticks === "number") {
        const speed = Math.max(1, params.speed ?? 1);
        return Math.ceil((params.ticks / 40) * 1000 / speed) * 2 + 15_000;
    }
    return undefined;
}
