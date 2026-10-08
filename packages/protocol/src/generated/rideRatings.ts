// Fichier généré par tools/gen-tables.mjs à partir de ~/Documents/OpenRCT2. Ne pas modifier à la main.
/** Modificateur de note (RatingsModifier, ride/RideData.h) : seuil et coefficients bruts du C++. */
export interface RatingsModifierData {
    type: string;
    threshold: number;
    excitement: number;
    intensity: number;
    nausea: number;
}

/** RideTypeDescriptor.RatingsData et ce qui sert au calcul des notes (RideRatings.cpp). Notes en centièmes. */
export interface RideRatingsData {
    name: string;
    calculation: string;
    base: { excitement: number; intensity: number; nausea: number };
    unreliability: number;
    /** -1 : abri calculé (kDynamicRideShelterRating). */
    rideShelter: number;
    relaxRequirementsIfInversions: boolean;
    modifiers: RatingsModifierData[];
    hasAirTime: boolean;
    hasGForces: boolean;
    /** RideHeights, en unités monde (8 par demi-niveau). */
    heights: { maxHeight: number; clearanceHeight: number; vehicleZOffset: number; platformHeight: number } | null;
}

/** Par type d'attraction (rideType). */
export const RIDE_RATINGS: Readonly<Record<number, RideRatingsData>> = {
    "0": {
        "name": "spiral_roller_coaster",
        "calculation": "normal",
        "base": {
            "excitement": 330,
            "intensity": 30,
            "nausea": 30
        },
        "unreliability": 14,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 819,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 40,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 140434,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 51366,
                "intensity": 85019,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 364088,
                "intensity": 400497,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 36864,
                "intensity": 30384,
                "nausea": 49648
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 28235,
                "intensity": 34767,
                "nausea": 45749
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 43690,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 15420,
                "intensity": 32768,
                "nausea": 35108
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 20130,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 6693,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementDropHeight",
                "threshold": 12,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 655360,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNegativeGs",
                "threshold": 40,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNumDrops",
                "threshold": 2,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 36864,
                "intensity": 30384,
                "nausea": 49648
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 19,
            "clearanceHeight": 24,
            "vehicleZOffset": 9,
            "platformHeight": 11
        }
    },
    "1": {
        "name": "stand_up_roller_coaster",
        "calculation": "normal",
        "base": {
            "excitement": 250,
            "intensity": 300,
            "nausea": 300
        },
        "unreliability": 17,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 40,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 123987,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 291271,
                "intensity": 436906,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 35746,
                "nausea": 59578
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 26749,
                "intensity": 34767,
                "nausea": 45749
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 34952,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 12850,
                "intensity": 28398,
                "nausea": 30427
            },
            {
                "type": "bonusReversedTrains",
                "threshold": 0,
                "excitement": 2,
                "intensity": 20,
                "nausea": 30
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 17893,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 5577,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementDropHeight",
                "threshold": 12,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 655360,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNegativeGs",
                "threshold": 50,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 35746,
                "nausea": 59578
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 25,
            "clearanceHeight": 24,
            "vehicleZOffset": 9,
            "platformHeight": 11
        }
    },
    "2": {
        "name": "suspended_swinging_coaster",
        "calculation": "normal",
        "base": {
            "excitement": 330,
            "intensity": 290,
            "nausea": 350
        },
        "unreliability": 18,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 40,
                "intensity": 10,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 291271,
                "intensity": 436906,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 32768,
                "intensity": 23831,
                "nausea": 79437
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 26749,
                "intensity": 34767,
                "nausea": 48036
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 29127,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 15420,
                "intensity": 32768,
                "nausea": 35108
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 20130,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 6971,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementDropHeight",
                "threshold": 8,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 786432,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNegativeGs",
                "threshold": 60,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementLateralGs",
                "threshold": 150,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementLength",
                "threshold": 24248320,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 32768,
                "intensity": 23831,
                "nausea": 79437
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 24,
            "clearanceHeight": 40,
            "vehicleZOffset": 29,
            "platformHeight": 8
        }
    },
    "3": {
        "name": "inverted_roller_coaster",
        "calculation": "normal",
        "base": {
            "excitement": 360,
            "intensity": 280,
            "nausea": 320
        },
        "unreliability": 17,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": true,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 42,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 291271,
                "intensity": 436906,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 29789,
                "nausea": 55606
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 26749,
                "intensity": 29552,
                "nausea": 57186
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 29127,
                "intensity": 39009,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 15420,
                "intensity": 15291,
                "nausea": 35108
            },
            {
                "type": "bonusReversedTrains",
                "threshold": 0,
                "excitement": 2,
                "intensity": 12,
                "nausea": 20
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 15657,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 8366,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementDropHeight",
                "threshold": 12,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 655360,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNegativeGs",
                "threshold": 30,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 29789,
                "nausea": 55606
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 42,
            "clearanceHeight": 40,
            "vehicleZOffset": 29,
            "platformHeight": 8
        }
    },
    "4": {
        "name": "junior_roller_coaster",
        "calculation": "normal",
        "base": {
            "excitement": 240,
            "intensity": 250,
            "nausea": 180
        },
        "unreliability": 13,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 40,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 291271,
                "intensity": 436906,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 20480,
                "intensity": 23831,
                "nausea": 49648
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 26749,
                "intensity": 34767,
                "nausea": 45749
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 29127,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 25700,
                "intensity": 30583,
                "nausea": 35108
            },
            {
                "type": "bonusReversedTrains",
                "threshold": 0,
                "excitement": 2,
                "intensity": 10,
                "nausea": 12
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 20130,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 9760,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementDropHeight",
                "threshold": 6,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 458752,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNumDrops",
                "threshold": 1,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 20480,
                "intensity": 23831,
                "nausea": 49648
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 12,
            "clearanceHeight": 24,
            "vehicleZOffset": 4,
            "platformHeight": 7
        }
    },
    "5": {
        "name": "miniature_railway",
        "calculation": "normal",
        "base": {
            "excitement": 250,
            "intensity": 0,
            "nausea": 0
        },
        "unreliability": 11,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 140434,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 291271,
                "intensity": 436906,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": -6425,
                "intensity": 6553,
                "nausea": 23405
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 8946,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 20915,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementLength",
                "threshold": 13107200,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementUnsheltered",
                "threshold": 4,
                "excitement": 4,
                "intensity": 1,
                "nausea": 1
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": {
            "maxHeight": 7,
            "clearanceHeight": 32,
            "vehicleZOffset": 5,
            "platformHeight": 9
        }
    },
    "6": {
        "name": "monorail",
        "calculation": "normal",
        "base": {
            "excitement": 200,
            "intensity": 0,
            "nausea": 0
        },
        "unreliability": 14,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 93622,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 70849,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 291271,
                "intensity": 218453,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 21845,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 5140,
                "intensity": 6553,
                "nausea": 18724
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 8946,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 16732,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementLength",
                "threshold": 11141120,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementUnsheltered",
                "threshold": 4,
                "excitement": 4,
                "intensity": 1,
                "nausea": 1
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": {
            "maxHeight": 8,
            "clearanceHeight": 32,
            "vehicleZOffset": 8,
            "platformHeight": 9
        }
    },
    "7": {
        "name": "mini_suspended_coaster",
        "calculation": "normal",
        "base": {
            "excitement": 280,
            "intensity": 250,
            "nausea": 270
        },
        "unreliability": 15,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 45,
                "intensity": 15,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 291271,
                "intensity": 436906,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 35746,
                "nausea": 49648
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 34179,
                "intensity": 34767,
                "nausea": 45749
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 58254,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 19275,
                "intensity": 32768,
                "nausea": 35108
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 20130,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 13943,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementDropHeight",
                "threshold": 6,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 524288,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementLateralGs",
                "threshold": 130,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementLength",
                "threshold": 13107200,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 35746,
                "nausea": 49648
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 10,
            "clearanceHeight": 24,
            "vehicleZOffset": 24,
            "platformHeight": 8
        }
    },
    "8": {
        "name": "boat_hire",
        "calculation": "normal",
        "base": {
            "excitement": 190,
            "intensity": 80,
            "nausea": 90
        },
        "unreliability": 7,
        "rideShelter": 0,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusBoatHireNoCircuit",
                "threshold": 0,
                "excitement": 20,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 11183,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 22310,
                "intensity": 0,
                "nausea": 0
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": {
            "maxHeight": 255,
            "clearanceHeight": 16,
            "vehicleZOffset": 0,
            "platformHeight": 3
        }
    },
    "9": {
        "name": "wooden_wild_mouse",
        "calculation": "normal",
        "base": {
            "excitement": 290,
            "intensity": 290,
            "nausea": 210
        },
        "unreliability": 14,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 873,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 40,
                "intensity": 8,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 364088,
                "intensity": 655360,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 102400,
                "intensity": 35746,
                "nausea": 49648
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 29721,
                "intensity": 43458,
                "nausea": 45749
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 40777,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 16705,
                "intensity": 30583,
                "nausea": 35108
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 17893,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 5577,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementDropHeight",
                "threshold": 8,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 458752,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNegativeGs",
                "threshold": 10,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementLateralGs",
                "threshold": 150,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementLength",
                "threshold": 11141120,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNumDrops",
                "threshold": 3,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 102400,
                "intensity": 35746,
                "nausea": 49648
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 14,
            "clearanceHeight": 24,
            "vehicleZOffset": 4,
            "platformHeight": 7
        }
    },
    "10": {
        "name": "steeplechase",
        "calculation": "normal",
        "base": {
            "excitement": 270,
            "intensity": 240,
            "nausea": 180
        },
        "unreliability": 14,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 75,
                "intensity": 9,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 291271,
                "intensity": 436906,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 20480,
                "intensity": 20852,
                "nausea": 49648
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 26749,
                "intensity": 34767,
                "nausea": 45749
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 29127,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 25700,
                "intensity": 30583,
                "nausea": 35108
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 20130,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 9760,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementDropHeight",
                "threshold": 4,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 524288,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNegativeGs",
                "threshold": 50,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementLength",
                "threshold": 15728640,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNumDrops",
                "threshold": 2,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 20480,
                "intensity": 20852,
                "nausea": 49648
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 14,
            "clearanceHeight": 24,
            "vehicleZOffset": 7,
            "platformHeight": 7
        }
    },
    "11": {
        "name": "car_ride",
        "calculation": "normal",
        "base": {
            "excitement": 200,
            "intensity": 50,
            "nausea": 0
        },
        "unreliability": 12,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 15,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 291271,
                "intensity": 436906,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 14860,
                "intensity": 0,
                "nausea": 11437
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 8738,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 12850,
                "intensity": 6553,
                "nausea": 4681
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 11183,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 8366,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementLength",
                "threshold": 13107200,
                "excitement": 8,
                "intensity": 2,
                "nausea": 2
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": {
            "maxHeight": 6,
            "clearanceHeight": 24,
            "vehicleZOffset": 4,
            "platformHeight": 7
        }
    },
    "12": {
        "name": "launched_freefall",
        "calculation": "normal",
        "base": {
            "excitement": 270,
            "intensity": 300,
            "nausea": 350
        },
        "unreliability": 16,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusDownwardLaunch",
                "threshold": 0,
                "excitement": 30,
                "intensity": 65,
                "nausea": 45
            },
            {
                "type": "bonusLaunchedFreefallSpecial",
                "threshold": 0,
                "excitement": 0,
                "intensity": 1355917,
                "nausea": 451972
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 20130,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 25098,
                "intensity": 0,
                "nausea": 0
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": {
            "maxHeight": 255,
            "clearanceHeight": 32,
            "vehicleZOffset": 3,
            "platformHeight": 2
        }
    },
    "13": {
        "name": "bobsleigh_coaster",
        "calculation": "normal",
        "base": {
            "excitement": 280,
            "intensity": 320,
            "nausea": 250
        },
        "unreliability": 16,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 20,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 291271,
                "intensity": 436906,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 65536,
                "intensity": 23831,
                "nausea": 49648
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 26749,
                "intensity": 34767,
                "nausea": 45749
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 29127,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 15420,
                "intensity": 32768,
                "nausea": 35108
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 20130,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 5577,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 786432,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementLateralGs",
                "threshold": 120,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementLength",
                "threshold": 24248320,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 65536,
                "intensity": 23831,
                "nausea": 49648
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 19,
            "clearanceHeight": 24,
            "vehicleZOffset": 5,
            "platformHeight": 7
        }
    },
    "14": {
        "name": "observation_tower",
        "calculation": "normal",
        "base": {
            "excitement": 150,
            "intensity": 0,
            "nausea": 10
        },
        "unreliability": 15,
        "rideShelter": 7,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 20130,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 83662,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusTowerRide",
                "threshold": 0,
                "excitement": 45875,
                "intensity": 0,
                "nausea": 26214
            },
            {
                "type": "requirementUnsheltered",
                "threshold": 5,
                "excitement": 4,
                "intensity": 1,
                "nausea": 1
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": {
            "maxHeight": 255,
            "clearanceHeight": 32,
            "vehicleZOffset": 3,
            "platformHeight": 2
        }
    },
    "15": {
        "name": "looping_roller_coaster",
        "calculation": "normal",
        "base": {
            "excitement": 300,
            "intensity": 50,
            "nausea": 20
        },
        "unreliability": 15,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": true,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 40,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 291271,
                "intensity": 436906,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 35746,
                "nausea": 49648
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 26749,
                "intensity": 34767,
                "nausea": 45749
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 29127,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 15420,
                "intensity": 32768,
                "nausea": 35108
            },
            {
                "type": "bonusReversedTrains",
                "threshold": 0,
                "excitement": 2,
                "intensity": 15,
                "nausea": 30
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 20130,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 6693,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementDropHeight",
                "threshold": 14,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 655360,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNegativeGs",
                "threshold": 10,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNumDrops",
                "threshold": 2,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 35746,
                "nausea": 49648
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 35,
            "clearanceHeight": 24,
            "vehicleZOffset": 5,
            "platformHeight": 7
        }
    },
    "16": {
        "name": "dinghy_slide",
        "calculation": "normal",
        "base": {
            "excitement": 270,
            "intensity": 200,
            "nausea": 150
        },
        "unreliability": 13,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 50,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 291271,
                "intensity": 436906,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 65536,
                "intensity": 29789,
                "nausea": 49648
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 26749,
                "intensity": 34767,
                "nausea": 45749
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 29127,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 15420,
                "intensity": 32768,
                "nausea": 35108
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 11183,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 5577,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementDropHeight",
                "threshold": 12,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 458752,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementLength",
                "threshold": 9175040,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 65536,
                "intensity": 29789,
                "nausea": 49648
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 15,
            "clearanceHeight": 24,
            "vehicleZOffset": 5,
            "platformHeight": 7
        }
    },
    "17": {
        "name": "mine_train_coaster",
        "calculation": "normal",
        "base": {
            "excitement": 290,
            "intensity": 230,
            "nausea": 210
        },
        "unreliability": 16,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 40,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 291271,
                "intensity": 436906,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 40960,
                "intensity": 35746,
                "nausea": 49648
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 29721,
                "intensity": 34767,
                "nausea": 45749
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 29127,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 19275,
                "intensity": 32768,
                "nausea": 35108
            },
            {
                "type": "bonusReversedTrains",
                "threshold": 0,
                "excitement": 2,
                "intensity": 10,
                "nausea": 12
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 21472,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 16732,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementDropHeight",
                "threshold": 8,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 655360,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNegativeGs",
                "threshold": 10,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementLength",
                "threshold": 24248320,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNumDrops",
                "threshold": 2,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 40960,
                "intensity": 35746,
                "nausea": 49648
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 21,
            "clearanceHeight": 24,
            "vehicleZOffset": 4,
            "platformHeight": 7
        }
    },
    "18": {
        "name": "chairlift",
        "calculation": "normal",
        "base": {
            "excitement": 160,
            "intensity": 40,
            "nausea": 50
        },
        "unreliability": 14,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 291271,
                "intensity": 436906,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 7430,
                "intensity": 3476,
                "nausea": 4574
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": -19275,
                "intensity": 21845,
                "nausea": 23405
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 11183,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 25098,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementLength",
                "threshold": 9830400,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementStations",
                "threshold": 1,
                "excitement": 0,
                "intensity": 2,
                "nausea": 1
            },
            {
                "type": "requirementUnsheltered",
                "threshold": 4,
                "excitement": 4,
                "intensity": 1,
                "nausea": 1
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": {
            "maxHeight": 40,
            "clearanceHeight": 32,
            "vehicleZOffset": 28,
            "platformHeight": 2
        }
    },
    "19": {
        "name": "corkscrew_roller_coaster",
        "calculation": "normal",
        "base": {
            "excitement": 300,
            "intensity": 50,
            "nausea": 20
        },
        "unreliability": 16,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": true,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 40,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 291271,
                "intensity": 436906,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 35746,
                "nausea": 49648
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 26749,
                "intensity": 34767,
                "nausea": 45749
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 29127,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 15420,
                "intensity": 32768,
                "nausea": 35108
            },
            {
                "type": "bonusReversedTrains",
                "threshold": 0,
                "excitement": 2,
                "intensity": 12,
                "nausea": 20
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 20130,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 6693,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementDropHeight",
                "threshold": 12,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 655360,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNegativeGs",
                "threshold": 40,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNumDrops",
                "threshold": 2,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 35746,
                "nausea": 49648
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 28,
            "clearanceHeight": 24,
            "vehicleZOffset": 8,
            "platformHeight": 11
        }
    },
    "20": {
        "name": "maze",
        "calculation": "flatRide",
        "base": {
            "excitement": 130,
            "intensity": 50,
            "nausea": 0
        },
        "unreliability": 8,
        "rideShelter": 0,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusMazeSize",
                "threshold": 100,
                "excitement": 1,
                "intensity": 2,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 22310,
                "intensity": 0,
                "nausea": 0
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": {
            "maxHeight": 6,
            "clearanceHeight": 24,
            "vehicleZOffset": 0,
            "platformHeight": 1
        }
    },
    "21": {
        "name": "spiral_slide",
        "calculation": "flatRide",
        "base": {
            "excitement": 150,
            "intensity": 140,
            "nausea": 90
        },
        "unreliability": 8,
        "rideShelter": 2,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusSlideUnlimitedRides",
                "threshold": 0,
                "excitement": 40,
                "intensity": 20,
                "nausea": 25
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 25098,
                "intensity": 0,
                "nausea": 0
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": {
            "maxHeight": 15,
            "clearanceHeight": 128,
            "vehicleZOffset": 0,
            "platformHeight": 2
        }
    },
    "22": {
        "name": "go_karts",
        "calculation": "normal",
        "base": {
            "excitement": 142,
            "intensity": 173,
            "nausea": 40
        },
        "unreliability": 16,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 700,
                "excitement": 32768,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGoKartRace",
                "threshold": 4,
                "excitement": 140,
                "intensity": 50,
                "nausea": 0
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 4458,
                "intensity": 3476,
                "nausea": 5718
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 8738,
                "intensity": 5461,
                "nausea": 6553
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 2570,
                "intensity": 8738,
                "nausea": 2340
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 11183,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 16732,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementUnsheltered",
                "threshold": 6,
                "excitement": 2,
                "intensity": 1,
                "nausea": 1
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": {
            "maxHeight": 8,
            "clearanceHeight": 24,
            "vehicleZOffset": 2,
            "platformHeight": 1
        }
    },
    "23": {
        "name": "log_flume",
        "calculation": "normal",
        "base": {
            "excitement": 150,
            "intensity": 55,
            "nausea": 30
        },
        "unreliability": 15,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 2000,
                "excitement": 7208,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 40,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 531372,
                "intensity": 655360,
                "nausea": 301111
            },
            {
                "type": "bonusDuration",
                "threshold": 300,
                "excitement": 13107,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 22291,
                "intensity": 20860,
                "nausea": 4574
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 69905,
                "intensity": 62415,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 16705,
                "intensity": 30583,
                "nausea": 35108
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 22367,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 11155,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementDropHeight",
                "threshold": 6,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            }
        ],
        "hasAirTime": true,
        "hasGForces": false,
        "heights": {
            "maxHeight": 10,
            "clearanceHeight": 24,
            "vehicleZOffset": 7,
            "platformHeight": 9
        }
    },
    "24": {
        "name": "river_rapids",
        "calculation": "normal",
        "base": {
            "excitement": 120,
            "intensity": 70,
            "nausea": 50
        },
        "unreliability": 16,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 2000,
                "excitement": 6225,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 30,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 115130,
                "intensity": 159411,
                "nausea": 106274
            },
            {
                "type": "bonusDuration",
                "threshold": 500,
                "excitement": 13107,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 29721,
                "intensity": 22598,
                "nausea": 5718
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 40777,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 16705,
                "intensity": 30583,
                "nausea": 35108
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 31314,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 13943,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementDropHeight",
                "threshold": 2,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementLength",
                "threshold": 13107200,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            }
        ],
        "hasAirTime": true,
        "hasGForces": false,
        "heights": {
            "maxHeight": 9,
            "clearanceHeight": 32,
            "vehicleZOffset": 14,
            "platformHeight": 15
        }
    },
    "25": {
        "name": "dodgems",
        "calculation": "flatRide",
        "base": {
            "excitement": 130,
            "intensity": 50,
            "nausea": 35
        },
        "unreliability": 16,
        "rideShelter": 7,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusOperationOption",
                "threshold": 0,
                "excitement": 1,
                "intensity": -2,
                "nausea": 0
            },
            {
                "type": "bonusNumTrains",
                "threshold": 4,
                "excitement": 80,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 5577,
                "intensity": 0,
                "nausea": 0
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": {
            "maxHeight": 9,
            "clearanceHeight": 48,
            "vehicleZOffset": 2,
            "platformHeight": 2
        }
    },
    "26": {
        "name": "swinging_ship",
        "calculation": "flatRide",
        "base": {
            "excitement": 150,
            "intensity": 190,
            "nausea": 141
        },
        "unreliability": 10,
        "rideShelter": 0,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusOperationOption",
                "threshold": 0,
                "excitement": 5,
                "intensity": 5,
                "nausea": 10
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 16732,
                "intensity": 0,
                "nausea": 0
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": {
            "maxHeight": 12,
            "clearanceHeight": 112,
            "vehicleZOffset": 7,
            "platformHeight": 11
        }
    },
    "27": {
        "name": "swinging_inverter_ship",
        "calculation": "flatRide",
        "base": {
            "excitement": 250,
            "intensity": 270,
            "nausea": 274
        },
        "unreliability": 16,
        "rideShelter": 0,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusOperationOption",
                "threshold": 0,
                "excitement": 11,
                "intensity": 22,
                "nausea": 22
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 11155,
                "intensity": 0,
                "nausea": 0
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": {
            "maxHeight": 15,
            "clearanceHeight": 176,
            "vehicleZOffset": 7,
            "platformHeight": 11
        }
    },
    "28": {
        "name": "food_stall",
        "calculation": "stall",
        "base": {
            "excitement": 1,
            "intensity": 1,
            "nausea": 1
        },
        "unreliability": 1,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "noModifier",
                "threshold": 0,
                "excitement": 0,
                "intensity": 0,
                "nausea": 0
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": null
    },
    "30": {
        "name": "drink_stall",
        "calculation": "stall",
        "base": {
            "excitement": 1,
            "intensity": 1,
            "nausea": 1
        },
        "unreliability": 1,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "noModifier",
                "threshold": 0,
                "excitement": 0,
                "intensity": 0,
                "nausea": 0
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": null
    },
    "32": {
        "name": "shop",
        "calculation": "stall",
        "base": {
            "excitement": 1,
            "intensity": 1,
            "nausea": 1
        },
        "unreliability": 1,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "noModifier",
                "threshold": 0,
                "excitement": 0,
                "intensity": 0,
                "nausea": 0
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": null
    },
    "33": {
        "name": "merry_go_round",
        "calculation": "flatRide",
        "base": {
            "excitement": 60,
            "intensity": 15,
            "nausea": 30
        },
        "unreliability": 16,
        "rideShelter": 7,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusRotations",
                "threshold": 0,
                "excitement": 5,
                "intensity": 5,
                "nausea": 5
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 19521,
                "intensity": 0,
                "nausea": 0
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": {
            "maxHeight": 12,
            "clearanceHeight": 64,
            "vehicleZOffset": 3,
            "platformHeight": 2
        }
    },
    "35": {
        "name": "information_kiosk",
        "calculation": "stall",
        "base": {
            "excitement": 1,
            "intensity": 1,
            "nausea": 1
        },
        "unreliability": 1,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "noModifier",
                "threshold": 0,
                "excitement": 0,
                "intensity": 0,
                "nausea": 0
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": null
    },
    "36": {
        "name": "toilets",
        "calculation": "stall",
        "base": {
            "excitement": 1,
            "intensity": 1,
            "nausea": 1
        },
        "unreliability": 1,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "noModifier",
                "threshold": 0,
                "excitement": 0,
                "intensity": 0,
                "nausea": 0
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": null
    },
    "37": {
        "name": "ferris_wheel",
        "calculation": "flatRide",
        "base": {
            "excitement": 60,
            "intensity": 25,
            "nausea": 30
        },
        "unreliability": 16,
        "rideShelter": 0,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusRotations",
                "threshold": 0,
                "excitement": 25,
                "intensity": 25,
                "nausea": 25
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 41831,
                "intensity": 0,
                "nausea": 0
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": {
            "maxHeight": 16,
            "clearanceHeight": 176,
            "vehicleZOffset": 3,
            "platformHeight": 2
        }
    },
    "38": {
        "name": "motion_simulator",
        "calculation": "flatRide",
        "base": {
            "excitement": 1,
            "intensity": 1,
            "nausea": 1
        },
        "unreliability": 21,
        "rideShelter": 7,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusMotionSimulatorMode",
                "threshold": 0,
                "excitement": 0,
                "intensity": 0,
                "nausea": 0
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": {
            "maxHeight": 12,
            "clearanceHeight": 64,
            "vehicleZOffset": 3,
            "platformHeight": 2
        }
    },
    "39": {
        "name": "3d_cinema",
        "calculation": "flatRide",
        "base": {
            "excitement": 1,
            "intensity": 1,
            "nausea": 1
        },
        "unreliability": 21,
        "rideShelter": 7,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonus3DCinemaMode",
                "threshold": 0,
                "excitement": 0,
                "intensity": 0,
                "nausea": 0
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": {
            "maxHeight": 12,
            "clearanceHeight": 128,
            "vehicleZOffset": 3,
            "platformHeight": 2
        }
    },
    "40": {
        "name": "top_spin",
        "calculation": "flatRide",
        "base": {
            "excitement": 1,
            "intensity": 1,
            "nausea": 1
        },
        "unreliability": 19,
        "rideShelter": 0,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusTopSpinMode",
                "threshold": 0,
                "excitement": 0,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 11155,
                "intensity": 0,
                "nausea": 0
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": {
            "maxHeight": 16,
            "clearanceHeight": 112,
            "vehicleZOffset": 3,
            "platformHeight": 2
        }
    },
    "41": {
        "name": "space_rings",
        "calculation": "flatRide",
        "base": {
            "excitement": 150,
            "intensity": 210,
            "nausea": 650
        },
        "unreliability": 7,
        "rideShelter": 0,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 25098,
                "intensity": 0,
                "nausea": 0
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": {
            "maxHeight": 16,
            "clearanceHeight": 48,
            "vehicleZOffset": 3,
            "platformHeight": 2
        }
    },
    "42": {
        "name": "reverse_freefall_coaster",
        "calculation": "normal",
        "base": {
            "excitement": 200,
            "intensity": 320,
            "nausea": 280
        },
        "unreliability": 25,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 327,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 60,
                "intensity": 15,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 436906,
                "intensity": 436906,
                "nausea": 320398
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 41704,
                "nausea": 59578
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 12850,
                "intensity": 28398,
                "nausea": 11702
            },
            {
                "type": "bonusReversedTrains",
                "threshold": 0,
                "excitement": 2,
                "intensity": 10,
                "nausea": 25
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 17893,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 11155,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementDropHeight",
                "threshold": 34,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 255,
            "clearanceHeight": 32,
            "vehicleZOffset": 4,
            "platformHeight": 7
        }
    },
    "43": {
        "name": "lift",
        "calculation": "normal",
        "base": {
            "excitement": 111,
            "intensity": 35,
            "nausea": 30
        },
        "unreliability": 15,
        "rideShelter": 7,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 11183,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 83662,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusTowerRide",
                "threshold": 0,
                "excitement": 45875,
                "intensity": 0,
                "nausea": 26214
            },
            {
                "type": "requirementUnsheltered",
                "threshold": 5,
                "excitement": 4,
                "intensity": 1,
                "nausea": 1
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": {
            "maxHeight": 255,
            "clearanceHeight": 32,
            "vehicleZOffset": 3,
            "platformHeight": 2
        }
    },
    "44": {
        "name": "vertical_drop_roller_coaster",
        "calculation": "normal",
        "base": {
            "excitement": 320,
            "intensity": 80,
            "nausea": 30
        },
        "unreliability": 16,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 4000,
                "excitement": 1146,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 40,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 97418,
                "intensity": 141699,
                "nausea": 70849
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 291271,
                "intensity": 436906,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 40960,
                "intensity": 35746,
                "nausea": 49648
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 26749,
                "intensity": 34767,
                "nausea": 45749
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 58254,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 15420,
                "intensity": 32768,
                "nausea": 35108
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 20130,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 6693,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementDropHeight",
                "threshold": 20,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 655360,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNegativeGs",
                "threshold": 10,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNumDrops",
                "threshold": 1,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 40960,
                "intensity": 35746,
                "nausea": 49648
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 55,
            "clearanceHeight": 24,
            "vehicleZOffset": 8,
            "platformHeight": 11
        }
    },
    "45": {
        "name": "cash_machine",
        "calculation": "stall",
        "base": {
            "excitement": 1,
            "intensity": 1,
            "nausea": 1
        },
        "unreliability": 1,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "noModifier",
                "threshold": 0,
                "excitement": 0,
                "intensity": 0,
                "nausea": 0
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": null
    },
    "46": {
        "name": "twist",
        "calculation": "flatRide",
        "base": {
            "excitement": 113,
            "intensity": 97,
            "nausea": 190
        },
        "unreliability": 16,
        "rideShelter": 0,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusRotations",
                "threshold": 0,
                "excitement": 20,
                "intensity": 20,
                "nausea": 20
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 13943,
                "intensity": 0,
                "nausea": 0
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": {
            "maxHeight": 12,
            "clearanceHeight": 64,
            "vehicleZOffset": 3,
            "platformHeight": 2
        }
    },
    "47": {
        "name": "haunted_house",
        "calculation": "flatRide",
        "base": {
            "excitement": 341,
            "intensity": 153,
            "nausea": 10
        },
        "unreliability": 8,
        "rideShelter": 7,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "noModifier",
                "threshold": 0,
                "excitement": 0,
                "intensity": 0,
                "nausea": 0
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": {
            "maxHeight": 16,
            "clearanceHeight": 160,
            "vehicleZOffset": 3,
            "platformHeight": 2
        }
    },
    "48": {
        "name": "first_aid",
        "calculation": "stall",
        "base": {
            "excitement": 1,
            "intensity": 1,
            "nausea": 1
        },
        "unreliability": 1,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "noModifier",
                "threshold": 0,
                "excitement": 0,
                "intensity": 0,
                "nausea": 0
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": null
    },
    "49": {
        "name": "circus",
        "calculation": "flatRide",
        "base": {
            "excitement": 210,
            "intensity": 30,
            "nausea": 0
        },
        "unreliability": 9,
        "rideShelter": 7,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "noModifier",
                "threshold": 0,
                "excitement": 0,
                "intensity": 0,
                "nausea": 0
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": {
            "maxHeight": 12,
            "clearanceHeight": 128,
            "vehicleZOffset": 3,
            "platformHeight": 2
        }
    },
    "50": {
        "name": "ghost_train",
        "calculation": "normal",
        "base": {
            "excitement": 200,
            "intensity": 20,
            "nausea": 3
        },
        "unreliability": 12,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 15,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 291271,
                "intensity": 436906,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 14860,
                "intensity": 0,
                "nausea": 11437
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 8738,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 25700,
                "intensity": 6553,
                "nausea": 4681
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 11183,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 8366,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementLength",
                "threshold": 11796480,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 8,
            "clearanceHeight": 24,
            "vehicleZOffset": 6,
            "platformHeight": 7
        }
    },
    "51": {
        "name": "twister_roller_coaster",
        "calculation": "normal",
        "base": {
            "excitement": 350,
            "intensity": 40,
            "nausea": 30
        },
        "unreliability": 15,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": true,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 40,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 291271,
                "intensity": 436906,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 32768,
                "nausea": 49648
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 26749,
                "intensity": 34767,
                "nausea": 45749
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 29127,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 15420,
                "intensity": 32768,
                "nausea": 35108
            },
            {
                "type": "bonusReversedTrains",
                "threshold": 0,
                "excitement": 2,
                "intensity": 12,
                "nausea": 20
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 20130,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 6693,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementDropHeight",
                "threshold": 12,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 655360,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNegativeGs",
                "threshold": 40,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNumDrops",
                "threshold": 2,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 32768,
                "nausea": 49648
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 40,
            "clearanceHeight": 24,
            "vehicleZOffset": 8,
            "platformHeight": 9
        }
    },
    "52": {
        "name": "wooden_roller_coaster",
        "calculation": "normal",
        "base": {
            "excitement": 320,
            "intensity": 260,
            "nausea": 200
        },
        "unreliability": 19,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 873,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 40,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 364088,
                "intensity": 655360,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 40960,
                "intensity": 34555,
                "nausea": 49648
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 26749,
                "intensity": 43458,
                "nausea": 45749
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 40777,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 16705,
                "intensity": 30583,
                "nausea": 35108
            },
            {
                "type": "bonusReversedTrains",
                "threshold": 0,
                "excitement": 2,
                "intensity": 10,
                "nausea": 15
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 22367,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 11155,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementDropHeight",
                "threshold": 12,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 655360,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNegativeGs",
                "threshold": 10,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementLength",
                "threshold": 24248320,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNumDrops",
                "threshold": 2,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 40960,
                "intensity": 34555,
                "nausea": 49648
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 41,
            "clearanceHeight": 24,
            "vehicleZOffset": 8,
            "platformHeight": 11
        }
    },
    "53": {
        "name": "side_friction_roller_coaster",
        "calculation": "normal",
        "base": {
            "excitement": 250,
            "intensity": 200,
            "nausea": 150
        },
        "unreliability": 19,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 873,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 40,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 364088,
                "intensity": 655360,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 28672,
                "intensity": 35746,
                "nausea": 49648
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 26749,
                "intensity": 43458,
                "nausea": 45749
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 40777,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 16705,
                "intensity": 30583,
                "nausea": 35108
            },
            {
                "type": "bonusReversedTrains",
                "threshold": 0,
                "excitement": 2,
                "intensity": 10,
                "nausea": 12
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 22367,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 11155,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementDropHeight",
                "threshold": 6,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 327680,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementLength",
                "threshold": 16384000,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNumDrops",
                "threshold": 2,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 28672,
                "intensity": 35746,
                "nausea": 49648
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 18,
            "clearanceHeight": 24,
            "vehicleZOffset": 4,
            "platformHeight": 11
        }
    },
    "54": {
        "name": "steel_wild_mouse",
        "calculation": "normal",
        "base": {
            "excitement": 280,
            "intensity": 250,
            "nausea": 210
        },
        "unreliability": 14,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 873,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 40,
                "intensity": 8,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 364088,
                "intensity": 655360,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 102400,
                "intensity": 35746,
                "nausea": 49648
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 29721,
                "intensity": 43458,
                "nausea": 45749
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 40777,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 16705,
                "intensity": 30583,
                "nausea": 35108
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 17893,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 5577,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementDropHeight",
                "threshold": 6,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 458752,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementLateralGs",
                "threshold": 150,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementLength",
                "threshold": 11141120,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNumDrops",
                "threshold": 2,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 102400,
                "intensity": 35746,
                "nausea": 49648
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 16,
            "clearanceHeight": 24,
            "vehicleZOffset": 4,
            "platformHeight": 7
        }
    },
    "55": {
        "name": "multi_dimension_roller_coaster",
        "calculation": "normal",
        "base": {
            "excitement": 375,
            "intensity": 195,
            "nausea": 479
        },
        "unreliability": 18,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": true,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 40,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 291271,
                "intensity": 436906,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 38130,
                "nausea": 49648
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 26749,
                "intensity": 34767,
                "nausea": 45749
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 29127,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 15420,
                "intensity": 32768,
                "nausea": 35108
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 20130,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 6693,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementInversions",
                "threshold": 1,
                "excitement": 4,
                "intensity": 1,
                "nausea": 1
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 655360,
                "excitement": 2,
                "intensity": 1,
                "nausea": 1
            },
            {
                "type": "requirementNegativeGs",
                "threshold": 40,
                "excitement": 2,
                "intensity": 1,
                "nausea": 1
            },
            {
                "type": "requirementNumDrops",
                "threshold": 2,
                "excitement": 2,
                "intensity": 1,
                "nausea": 1
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 38130,
                "nausea": 49648
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 40,
            "clearanceHeight": 24,
            "vehicleZOffset": 8,
            "platformHeight": 11
        }
    },
    "56": {
        "name": "multi_dimension_roller_coaster_alt",
        "calculation": "normal",
        "base": {
            "excitement": 375,
            "intensity": 195,
            "nausea": 479
        },
        "unreliability": 18,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": true,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 40,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 291271,
                "intensity": 436906,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 38130,
                "nausea": 49648
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 26749,
                "intensity": 34767,
                "nausea": 45749
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 29127,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 15420,
                "intensity": 32768,
                "nausea": 35108
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 20130,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 6693,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementInversions",
                "threshold": 1,
                "excitement": 4,
                "intensity": 1,
                "nausea": 1
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 655360,
                "excitement": 2,
                "intensity": 1,
                "nausea": 1
            },
            {
                "type": "requirementNegativeGs",
                "threshold": 40,
                "excitement": 2,
                "intensity": 1,
                "nausea": 1
            },
            {
                "type": "requirementNumDrops",
                "threshold": 2,
                "excitement": 2,
                "intensity": 1,
                "nausea": 1
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 38130,
                "nausea": 49648
            }
        ],
        "hasAirTime": false,
        "hasGForces": true,
        "heights": {
            "maxHeight": 40,
            "clearanceHeight": 24,
            "vehicleZOffset": 8,
            "platformHeight": 11
        }
    },
    "57": {
        "name": "flying_roller_coaster",
        "calculation": "normal",
        "base": {
            "excitement": 435,
            "intensity": 185,
            "nausea": 433
        },
        "unreliability": 17,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": true,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 40,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 291271,
                "intensity": 436906,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 38130,
                "nausea": 49648
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 26749,
                "intensity": 34767,
                "nausea": 45749
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 29127,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 15420,
                "intensity": 32768,
                "nausea": 35108
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 20130,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 6693,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementInversions",
                "threshold": 1,
                "excitement": 2,
                "intensity": 1,
                "nausea": 1
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 655360,
                "excitement": 2,
                "intensity": 1,
                "nausea": 1
            },
            {
                "type": "requirementNegativeGs",
                "threshold": 40,
                "excitement": 2,
                "intensity": 1,
                "nausea": 1
            },
            {
                "type": "requirementNumDrops",
                "threshold": 2,
                "excitement": 2,
                "intensity": 1,
                "nausea": 1
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 38130,
                "nausea": 49648
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 30,
            "clearanceHeight": 24,
            "vehicleZOffset": 8,
            "platformHeight": 11
        }
    },
    "58": {
        "name": "flying_roller_coaster_alt",
        "calculation": "normal",
        "base": {
            "excitement": 435,
            "intensity": 185,
            "nausea": 433
        },
        "unreliability": 17,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": true,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 40,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 291271,
                "intensity": 436906,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 38130,
                "nausea": 49648
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 26749,
                "intensity": 34767,
                "nausea": 45749
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 29127,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 15420,
                "intensity": 32768,
                "nausea": 35108
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 20130,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 6693,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementInversions",
                "threshold": 1,
                "excitement": 2,
                "intensity": 1,
                "nausea": 1
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 655360,
                "excitement": 2,
                "intensity": 1,
                "nausea": 1
            },
            {
                "type": "requirementNegativeGs",
                "threshold": 40,
                "excitement": 2,
                "intensity": 1,
                "nausea": 1
            },
            {
                "type": "requirementNumDrops",
                "threshold": 2,
                "excitement": 2,
                "intensity": 1,
                "nausea": 1
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 38130,
                "nausea": 49648
            }
        ],
        "hasAirTime": false,
        "hasGForces": true,
        "heights": {
            "maxHeight": 30,
            "clearanceHeight": 24,
            "vehicleZOffset": 8,
            "platformHeight": 11
        }
    },
    "59": {
        "name": "virginia_reel",
        "calculation": "normal",
        "base": {
            "excitement": 210,
            "intensity": 190,
            "nausea": 370
        },
        "unreliability": 19,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 873,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 40,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 364088,
                "intensity": 655360,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 110592,
                "intensity": 29789,
                "nausea": 59578
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 52012,
                "intensity": 26075,
                "nausea": 45749
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 43690,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 16705,
                "intensity": 30583,
                "nausea": 35108
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 22367,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 11155,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementLength",
                "threshold": 13762560,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNumDrops",
                "threshold": 2,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 110592,
                "intensity": 29789,
                "nausea": 59578
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 14,
            "clearanceHeight": 24,
            "vehicleZOffset": 6,
            "platformHeight": 7
        }
    },
    "60": {
        "name": "splash_boats",
        "calculation": "normal",
        "base": {
            "excitement": 146,
            "intensity": 35,
            "nausea": 30
        },
        "unreliability": 15,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 2000,
                "excitement": 7208,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 40,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 797059,
                "intensity": 655360,
                "nausea": 301111
            },
            {
                "type": "bonusDuration",
                "threshold": 500,
                "excitement": 13107,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 22291,
                "intensity": 20860,
                "nausea": 4574
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 87381,
                "intensity": 93622,
                "nausea": 62259
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 16705,
                "intensity": 30583,
                "nausea": 35108
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 22367,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 11155,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementDropHeight",
                "threshold": 6,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            }
        ],
        "hasAirTime": true,
        "hasGForces": false,
        "heights": {
            "maxHeight": 16,
            "clearanceHeight": 24,
            "vehicleZOffset": 7,
            "platformHeight": 11
        }
    },
    "61": {
        "name": "mini_helicopters",
        "calculation": "normal",
        "base": {
            "excitement": 160,
            "intensity": 40,
            "nausea": 0
        },
        "unreliability": 12,
        "rideShelter": 6,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 15,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 291271,
                "intensity": 436906,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 14860,
                "intensity": 0,
                "nausea": 4574
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 8738,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 12850,
                "intensity": 6553,
                "nausea": 4681
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 8946,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 8366,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementLength",
                "threshold": 10485760,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": {
            "maxHeight": 7,
            "clearanceHeight": 24,
            "vehicleZOffset": 4,
            "platformHeight": 7
        }
    },
    "62": {
        "name": "lay_down_roller_coaster",
        "calculation": "normal",
        "base": {
            "excitement": 385,
            "intensity": 115,
            "nausea": 275
        },
        "unreliability": 18,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": true,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 40,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 291271,
                "intensity": 436906,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 38130,
                "nausea": 49648
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 26749,
                "intensity": 34767,
                "nausea": 45749
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 29127,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 15420,
                "intensity": 32768,
                "nausea": 35108
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 20130,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 6693,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementInversions",
                "threshold": 1,
                "excitement": 4,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 655360,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNegativeGs",
                "threshold": 40,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNumDrops",
                "threshold": 2,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 38130,
                "nausea": 49648
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 26,
            "clearanceHeight": 24,
            "vehicleZOffset": 8,
            "platformHeight": 11
        }
    },
    "63": {
        "name": "suspended_monorail",
        "calculation": "normal",
        "base": {
            "excitement": 215,
            "intensity": 23,
            "nausea": 8
        },
        "unreliability": 14,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 93622,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 70849,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 291271,
                "intensity": 218453,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 21845,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 5140,
                "intensity": 6553,
                "nausea": 18724
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 12525,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 25098,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementLength",
                "threshold": 11141120,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementUnsheltered",
                "threshold": 4,
                "excitement": 4,
                "intensity": 1,
                "nausea": 1
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": {
            "maxHeight": 12,
            "clearanceHeight": 40,
            "vehicleZOffset": 32,
            "platformHeight": 8
        }
    },
    "64": {
        "name": "lay_down_roller_coaster_alt",
        "calculation": "normal",
        "base": {
            "excitement": 385,
            "intensity": 115,
            "nausea": 275
        },
        "unreliability": 18,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": true,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 40,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 291271,
                "intensity": 436906,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 38130,
                "nausea": 49648
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 26749,
                "intensity": 34767,
                "nausea": 45749
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 29127,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 15420,
                "intensity": 32768,
                "nausea": 35108
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 20130,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 6693,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementInversions",
                "threshold": 1,
                "excitement": 4,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 655360,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNegativeGs",
                "threshold": 40,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNumDrops",
                "threshold": 2,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 38130,
                "nausea": 49648
            }
        ],
        "hasAirTime": false,
        "hasGForces": true,
        "heights": {
            "maxHeight": 26,
            "clearanceHeight": 24,
            "vehicleZOffset": 8,
            "platformHeight": 11
        }
    },
    "65": {
        "name": "reverser_roller_coaster",
        "calculation": "normal",
        "base": {
            "excitement": 240,
            "intensity": 180,
            "nausea": 170
        },
        "unreliability": 19,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 873,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 40,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 364088,
                "intensity": 655360,
                "nausea": 0
            },
            {
                "type": "bonusReversals",
                "threshold": 6,
                "excitement": 20,
                "intensity": 20,
                "nausea": 20
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 28672,
                "intensity": 23831,
                "nausea": 49648
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 26749,
                "intensity": 43458,
                "nausea": 45749
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 40777,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 16705,
                "intensity": 30583,
                "nausea": 35108
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 22367,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 11155,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementReversals",
                "threshold": 1,
                "excitement": 8,
                "intensity": 1,
                "nausea": 1
            },
            {
                "type": "requirementLength",
                "threshold": 13107200,
                "excitement": 2,
                "intensity": 1,
                "nausea": 1
            },
            {
                "type": "requirementNumDrops",
                "threshold": 2,
                "excitement": 2,
                "intensity": 1,
                "nausea": 1
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 28672,
                "intensity": 23831,
                "nausea": 49648
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 18,
            "clearanceHeight": 24,
            "vehicleZOffset": 8,
            "platformHeight": 11
        }
    },
    "66": {
        "name": "heartline_twister_coaster",
        "calculation": "normal",
        "base": {
            "excitement": 300,
            "intensity": 170,
            "nausea": 165
        },
        "unreliability": 18,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 20,
                "intensity": 4,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 97418,
                "intensity": 123987,
                "nausea": 70849
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 291271,
                "intensity": 436906,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 44683,
                "nausea": 89367
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 26749,
                "intensity": 52150,
                "nausea": 57186
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 29127,
                "intensity": 53052,
                "nausea": 55705
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 15420,
                "intensity": 34952,
                "nausea": 35108
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 9841,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 3904,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementInversions",
                "threshold": 1,
                "excitement": 4,
                "intensity": 1,
                "nausea": 1
            },
            {
                "type": "requirementNumDrops",
                "threshold": 1,
                "excitement": 4,
                "intensity": 1,
                "nausea": 1
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 44683,
                "nausea": 89367
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 22,
            "clearanceHeight": 24,
            "vehicleZOffset": 15,
            "platformHeight": 9
        }
    },
    "67": {
        "name": "mini_golf",
        "calculation": "normal",
        "base": {
            "excitement": 150,
            "intensity": 90,
            "nausea": 0
        },
        "unreliability": 0,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 873,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 14860,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusHoles",
                "threshold": 6,
                "excitement": 6,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 5140,
                "intensity": 6553,
                "nausea": 4681
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 15657,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 27887,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusHoles",
                "threshold": 31,
                "excitement": 5,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementHoles",
                "threshold": 1,
                "excitement": 8,
                "intensity": 2,
                "nausea": 2
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": {
            "maxHeight": 7,
            "clearanceHeight": 32,
            "vehicleZOffset": 2,
            "platformHeight": 2
        }
    },
    "68": {
        "name": "giga_coaster",
        "calculation": "normal",
        "base": {
            "excitement": 385,
            "intensity": 40,
            "nausea": 35
        },
        "unreliability": 14,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 819,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 40,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 140434,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 51366,
                "intensity": 85019,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 364088,
                "intensity": 400497,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 36864,
                "intensity": 30384,
                "nausea": 49648
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 28235,
                "intensity": 34767,
                "nausea": 45749
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 43690,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 15420,
                "intensity": 32768,
                "nausea": 35108
            },
            {
                "type": "bonusReversedTrains",
                "threshold": 0,
                "excitement": 2,
                "intensity": 20,
                "nausea": 20
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 20130,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 6693,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementDropHeight",
                "threshold": 16,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 655360,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNegativeGs",
                "threshold": 40,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNumDrops",
                "threshold": 2,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 36864,
                "intensity": 30384,
                "nausea": 49648
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 86,
            "clearanceHeight": 24,
            "vehicleZOffset": 9,
            "platformHeight": 11
        }
    },
    "69": {
        "name": "roto_drop",
        "calculation": "normal",
        "base": {
            "excitement": 280,
            "intensity": 350,
            "nausea": 350
        },
        "unreliability": 24,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 11183,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 25098,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusRotoDrop",
                "threshold": 0,
                "excitement": 0,
                "intensity": 0,
                "nausea": 0
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": {
            "maxHeight": 255,
            "clearanceHeight": 32,
            "vehicleZOffset": 3,
            "platformHeight": 2
        }
    },
    "70": {
        "name": "flying_saucers",
        "calculation": "flatRide",
        "base": {
            "excitement": 240,
            "intensity": 55,
            "nausea": 39
        },
        "unreliability": 32,
        "rideShelter": 0,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusOperationOption",
                "threshold": 0,
                "excitement": 1,
                "intensity": -2,
                "nausea": 0
            },
            {
                "type": "bonusNumTrains",
                "threshold": 4,
                "excitement": 80,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 5577,
                "intensity": 0,
                "nausea": 0
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": {
            "maxHeight": 9,
            "clearanceHeight": 48,
            "vehicleZOffset": 2,
            "platformHeight": 2
        }
    },
    "71": {
        "name": "crooked_house",
        "calculation": "flatRide",
        "base": {
            "excitement": 215,
            "intensity": 62,
            "nausea": 34
        },
        "unreliability": 5,
        "rideShelter": 7,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "noModifier",
                "threshold": 0,
                "excitement": 0,
                "intensity": 0,
                "nausea": 0
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": {
            "maxHeight": 16,
            "clearanceHeight": 96,
            "vehicleZOffset": 3,
            "platformHeight": 2
        }
    },
    "72": {
        "name": "monorail_cycles",
        "calculation": "normal",
        "base": {
            "excitement": 140,
            "intensity": 20,
            "nausea": 0
        },
        "unreliability": 4,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 15,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 291271,
                "intensity": 436906,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 14860,
                "intensity": 0,
                "nausea": 4574
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 8738,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 5140,
                "intensity": 6553,
                "nausea": 2340
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 8946,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 11155,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementLength",
                "threshold": 9175040,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": {
            "maxHeight": 5,
            "clearanceHeight": 24,
            "vehicleZOffset": 8,
            "platformHeight": 7
        }
    },
    "73": {
        "name": "compact_inverted_coaster",
        "calculation": "normal",
        "base": {
            "excitement": 315,
            "intensity": 280,
            "nausea": 320
        },
        "unreliability": 21,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": true,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 42,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 291271,
                "intensity": 436906,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 30980,
                "nausea": 55606
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 26749,
                "intensity": 29552,
                "nausea": 57186
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 29127,
                "intensity": 39009,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 15420,
                "intensity": 15291,
                "nausea": 35108
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 15657,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 8366,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementDropHeight",
                "threshold": 12,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 655360,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNegativeGs",
                "threshold": 30,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 30980,
                "nausea": 55606
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 27,
            "clearanceHeight": 40,
            "vehicleZOffset": 29,
            "platformHeight": 8
        }
    },
    "74": {
        "name": "water_coaster",
        "calculation": "normal",
        "base": {
            "excitement": 270,
            "intensity": 280,
            "nausea": 210
        },
        "unreliability": 14,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 40,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 291271,
                "intensity": 436906,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 20480,
                "intensity": 23831,
                "nausea": 49648
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 26749,
                "intensity": 34767,
                "nausea": 45749
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 29127,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 25700,
                "intensity": 30583,
                "nausea": 35108
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 20130,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 9760,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementDropHeight",
                "threshold": 8,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 458752,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNumDrops",
                "threshold": 1,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementSplashdown",
                "threshold": 0,
                "excitement": 8,
                "intensity": 1,
                "nausea": 1
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 20480,
                "intensity": 23831,
                "nausea": 49648
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 18,
            "clearanceHeight": 24,
            "vehicleZOffset": 4,
            "platformHeight": 7
        }
    },
    "75": {
        "name": "air_powered_vertical_coaster",
        "calculation": "normal",
        "base": {
            "excitement": 413,
            "intensity": 250,
            "nausea": 280
        },
        "unreliability": 28,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 327,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 60,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 509724,
                "intensity": 364088,
                "nausea": 320398
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 35746,
                "nausea": 59578
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 15420,
                "intensity": 21845,
                "nausea": 11702
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 17893,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 11155,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementDropHeight",
                "threshold": 34,
                "excitement": 4,
                "intensity": 1,
                "nausea": 1
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 35746,
                "nausea": 59578
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 255,
            "clearanceHeight": 32,
            "vehicleZOffset": 4,
            "platformHeight": 7
        }
    },
    "76": {
        "name": "inverted_hairpin_coaster",
        "calculation": "normal",
        "base": {
            "excitement": 300,
            "intensity": 265,
            "nausea": 225
        },
        "unreliability": 14,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 873,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 40,
                "intensity": 8,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 364088,
                "intensity": 655360,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 102400,
                "intensity": 35746,
                "nausea": 49648
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 29721,
                "intensity": 43458,
                "nausea": 45749
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 40777,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 16705,
                "intensity": 30583,
                "nausea": 35108
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 17893,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 5577,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementDropHeight",
                "threshold": 8,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 458752,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNegativeGs",
                "threshold": 10,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementLateralGs",
                "threshold": 150,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementLength",
                "threshold": 11141120,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNumDrops",
                "threshold": 3,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 102400,
                "intensity": 35746,
                "nausea": 49648
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 16,
            "clearanceHeight": 24,
            "vehicleZOffset": 24,
            "platformHeight": 7
        }
    },
    "77": {
        "name": "magic_carpet",
        "calculation": "flatRide",
        "base": {
            "excitement": 245,
            "intensity": 160,
            "nausea": 260
        },
        "unreliability": 16,
        "rideShelter": 0,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusOperationOption",
                "threshold": 0,
                "excitement": 10,
                "intensity": 20,
                "nausea": 20
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 11155,
                "intensity": 0,
                "nausea": 0
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": {
            "maxHeight": 15,
            "clearanceHeight": 176,
            "vehicleZOffset": 7,
            "platformHeight": 11
        }
    },
    "78": {
        "name": "submarine_ride",
        "calculation": "normal",
        "base": {
            "excitement": 220,
            "intensity": 180,
            "nausea": 140
        },
        "unreliability": 7,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 11183,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 22310,
                "intensity": 0,
                "nausea": 0
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": {
            "maxHeight": 255,
            "clearanceHeight": 16,
            "vehicleZOffset": 0,
            "platformHeight": 3
        }
    },
    "79": {
        "name": "river_rafts",
        "calculation": "normal",
        "base": {
            "excitement": 145,
            "intensity": 25,
            "nausea": 34
        },
        "unreliability": 12,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 2000,
                "excitement": 7208,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 40,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 531372,
                "intensity": 655360,
                "nausea": 301111
            },
            {
                "type": "bonusDuration",
                "threshold": 500,
                "excitement": 13107,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 22291,
                "intensity": 20860,
                "nausea": 4574
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 78643,
                "intensity": 93622,
                "nausea": 62259
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 13420,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 11155,
                "intensity": 0,
                "nausea": 0
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": {
            "maxHeight": 12,
            "clearanceHeight": 24,
            "vehicleZOffset": 7,
            "platformHeight": 11
        }
    },
    "81": {
        "name": "enterprise",
        "calculation": "flatRide",
        "base": {
            "excitement": 360,
            "intensity": 455,
            "nausea": 572
        },
        "unreliability": 22,
        "rideShelter": 3,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusOperationOption",
                "threshold": 0,
                "excitement": 1,
                "intensity": 16,
                "nausea": 16
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 19521,
                "intensity": 0,
                "nausea": 0
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": {
            "maxHeight": 16,
            "clearanceHeight": 160,
            "vehicleZOffset": 3,
            "platformHeight": 2
        }
    },
    "86": {
        "name": "inverted_impulse_coaster",
        "calculation": "normal",
        "base": {
            "excitement": 400,
            "intensity": 300,
            "nausea": 320
        },
        "unreliability": 20,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 42,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 291271,
                "intensity": 436906,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 29789,
                "nausea": 55606
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 26749,
                "intensity": 29552,
                "nausea": 57186
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 29127,
                "intensity": 39009,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 15420,
                "intensity": 15291,
                "nausea": 35108
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 15657,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 9760,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementDropHeight",
                "threshold": 20,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 655360,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 29789,
                "nausea": 55606
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 45,
            "clearanceHeight": 40,
            "vehicleZOffset": 29,
            "platformHeight": 8
        }
    },
    "87": {
        "name": "mini_roller_coaster",
        "calculation": "normal",
        "base": {
            "excitement": 255,
            "intensity": 240,
            "nausea": 185
        },
        "unreliability": 13,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 40,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 291271,
                "intensity": 436906,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 20480,
                "intensity": 23831,
                "nausea": 49648
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 26749,
                "intensity": 34767,
                "nausea": 45749
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 29127,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 25700,
                "intensity": 30583,
                "nausea": 35108
            },
            {
                "type": "bonusReversedTrains",
                "threshold": 0,
                "excitement": 2,
                "intensity": 10,
                "nausea": 12
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 20130,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 9760,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementDropHeight",
                "threshold": 12,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 458752,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNegativeGs",
                "threshold": 50,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNumDrops",
                "threshold": 2,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 20480,
                "intensity": 23831,
                "nausea": 49648
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 16,
            "clearanceHeight": 24,
            "vehicleZOffset": 9,
            "platformHeight": 11
        }
    },
    "88": {
        "name": "mine_ride",
        "calculation": "normal",
        "base": {
            "excitement": 275,
            "intensity": 100,
            "nausea": 180
        },
        "unreliability": 16,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 40,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 291271,
                "intensity": 436906,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 40960,
                "intensity": 29789,
                "nausea": 49648
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 29721,
                "intensity": 34767,
                "nausea": 45749
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 29127,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 19275,
                "intensity": 32768,
                "nausea": 35108
            },
            {
                "type": "bonusReversedTrains",
                "threshold": 0,
                "excitement": 2,
                "intensity": 10,
                "nausea": 12
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 21472,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 16732,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementLength",
                "threshold": 17694720,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 40960,
                "intensity": 29789,
                "nausea": 49648
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 13,
            "clearanceHeight": 24,
            "vehicleZOffset": 9,
            "platformHeight": 11
        }
    },
    "90": {
        "name": "lim_launched_roller_coaster",
        "calculation": "normal",
        "base": {
            "excitement": 290,
            "intensity": 150,
            "nausea": 220
        },
        "unreliability": 25,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": true,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 40,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 291271,
                "intensity": 436906,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 35746,
                "nausea": 49648
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 26749,
                "intensity": 34767,
                "nausea": 45749
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 29127,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 15420,
                "intensity": 32768,
                "nausea": 35108
            },
            {
                "type": "bonusReversedTrains",
                "threshold": 0,
                "excitement": 2,
                "intensity": 15,
                "nausea": 20
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 20130,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 6693,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementDropHeight",
                "threshold": 10,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 655360,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNegativeGs",
                "threshold": 10,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNumDrops",
                "threshold": 2,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 35746,
                "nausea": 49648
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 35,
            "clearanceHeight": 24,
            "vehicleZOffset": 5,
            "platformHeight": 7
        }
    },
    "91": {
        "name": "hybrid_coaster",
        "calculation": "normal",
        "base": {
            "excitement": 380,
            "intensity": 100,
            "nausea": 45
        },
        "unreliability": 16,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 40,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 364088,
                "intensity": 400497,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 40960,
                "intensity": 35746,
                "nausea": 49648
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 34179,
                "intensity": 34767,
                "nausea": 45749
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 34952,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 15420,
                "intensity": 32768,
                "nausea": 35108
            },
            {
                "type": "bonusReversedTrains",
                "threshold": 0,
                "excitement": 2,
                "intensity": 15,
                "nausea": 25
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 22367,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 6693,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementDropHeight",
                "threshold": 14,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 655360,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNegativeGs",
                "threshold": 40,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNumDrops",
                "threshold": 2,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 35746,
                "nausea": 49648
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 43,
            "clearanceHeight": 24,
            "vehicleZOffset": 13,
            "platformHeight": 13
        }
    },
    "92": {
        "name": "single_rail_roller_coaster",
        "calculation": "normal",
        "base": {
            "excitement": 350,
            "intensity": 60,
            "nausea": 40
        },
        "unreliability": 16,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 40,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 364088,
                "intensity": 436906,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 36864,
                "intensity": 35746,
                "nausea": 49648
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 26749,
                "intensity": 34767,
                "nausea": 45749
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 29127,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 15420,
                "intensity": 32768,
                "nausea": 35108
            },
            {
                "type": "bonusReversedTrains",
                "threshold": 0,
                "excitement": 2,
                "intensity": 15,
                "nausea": 25
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 22367,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 6693,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementDropHeight",
                "threshold": 14,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 655360,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNegativeGs",
                "threshold": 40,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNumDrops",
                "threshold": 2,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 35746,
                "nausea": 49648
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 28,
            "clearanceHeight": 24,
            "vehicleZOffset": 5,
            "platformHeight": 7
        }
    },
    "93": {
        "name": "alpine_coaster",
        "calculation": "normal",
        "base": {
            "excitement": 230,
            "intensity": 210,
            "nausea": 104
        },
        "unreliability": 7,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 873,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 75,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 291271,
                "intensity": 436906,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 300,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 29721,
                "intensity": 34767,
                "nausea": 45749
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 8738,
                "intensity": 5461,
                "nausea": 6553
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 15420,
                "intensity": 32768,
                "nausea": 35108
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 22367,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 11155,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 327680,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementLength",
                "threshold": 24248320,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            }
        ],
        "hasAirTime": false,
        "hasGForces": false,
        "heights": {
            "maxHeight": 18,
            "clearanceHeight": 24,
            "vehicleZOffset": 3,
            "platformHeight": 7
        }
    },
    "94": {
        "name": "classic_wooden_roller_coaster",
        "calculation": "normal",
        "base": {
            "excitement": 280,
            "intensity": 260,
            "nausea": 200
        },
        "unreliability": 19,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 873,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 40,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 364088,
                "intensity": 655360,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 40960,
                "intensity": 34555,
                "nausea": 49648
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 26749,
                "intensity": 43458,
                "nausea": 45749
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 40777,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 16705,
                "intensity": 30583,
                "nausea": 35108
            },
            {
                "type": "bonusReversedTrains",
                "threshold": 0,
                "excitement": 2,
                "intensity": 12,
                "nausea": 22
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 22367,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 11155,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementDropHeight",
                "threshold": 12,
                "excitement": 2,
                "intensity": 1,
                "nausea": 2
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 655360,
                "excitement": 2,
                "intensity": 1,
                "nausea": 2
            },
            {
                "type": "requirementNegativeGs",
                "threshold": 10,
                "excitement": 2,
                "intensity": 1,
                "nausea": 2
            },
            {
                "type": "requirementLength",
                "threshold": 24248320,
                "excitement": 2,
                "intensity": 1,
                "nausea": 2
            },
            {
                "type": "requirementNumDrops",
                "threshold": 2,
                "excitement": 2,
                "intensity": 1,
                "nausea": 2
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 40960,
                "intensity": 34555,
                "nausea": 49648
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 24,
            "clearanceHeight": 24,
            "vehicleZOffset": 8,
            "platformHeight": 11
        }
    },
    "95": {
        "name": "classic_stand_up_roller_coaster",
        "calculation": "normal",
        "base": {
            "excitement": 250,
            "intensity": 300,
            "nausea": 300
        },
        "unreliability": 17,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 40,
                "intensity": 10,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 123987,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 291271,
                "intensity": 436906,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 35746,
                "nausea": 59578
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 26749,
                "intensity": 34767,
                "nausea": 45749
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 34952,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 12850,
                "intensity": 28398,
                "nausea": 30427
            },
            {
                "type": "bonusReversedTrains",
                "threshold": 0,
                "excitement": 2,
                "intensity": 20,
                "nausea": 30
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 17893,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 5577,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementDropHeight",
                "threshold": 12,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 655360,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNegativeGs",
                "threshold": 50,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 35746,
                "nausea": 59578
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 30,
            "clearanceHeight": 24,
            "vehicleZOffset": 9,
            "platformHeight": 11
        }
    },
    "96": {
        "name": "lsm_launched_roller_coaster",
        "calculation": "normal",
        "base": {
            "excitement": 385,
            "intensity": 40,
            "nausea": 35
        },
        "unreliability": 14,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 764,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 40,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 291271,
                "intensity": 436906,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 35746,
                "nausea": 49648
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 26749,
                "intensity": 34767,
                "nausea": 45749
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 29127,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 15420,
                "intensity": 32768,
                "nausea": 35108
            },
            {
                "type": "bonusReversedTrains",
                "threshold": 0,
                "excitement": 2,
                "intensity": 15,
                "nausea": 20
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 20130,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 6693,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementDropHeight",
                "threshold": 10,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 655360,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNegativeGs",
                "threshold": 10,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNumDrops",
                "threshold": 2,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 24576,
                "intensity": 35746,
                "nausea": 49648
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 33,
            "clearanceHeight": 24,
            "vehicleZOffset": 9,
            "platformHeight": 11
        }
    },
    "97": {
        "name": "classic_wooden_twister_roller_coaster",
        "calculation": "normal",
        "base": {
            "excitement": 320,
            "intensity": 260,
            "nausea": 200
        },
        "unreliability": 19,
        "rideShelter": -1,
        "relaxRequirementsIfInversions": false,
        "modifiers": [
            {
                "type": "bonusLength",
                "threshold": 6000,
                "excitement": 873,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusSynchronisation",
                "threshold": 0,
                "excitement": 40,
                "intensity": 5,
                "nausea": 0
            },
            {
                "type": "bonusTrainLength",
                "threshold": 0,
                "excitement": 187245,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusMaxSpeed",
                "threshold": 0,
                "excitement": 44281,
                "intensity": 88562,
                "nausea": 35424
            },
            {
                "type": "bonusAverageSpeed",
                "threshold": 0,
                "excitement": 364088,
                "intensity": 655360,
                "nausea": 0
            },
            {
                "type": "bonusDuration",
                "threshold": 150,
                "excitement": 26214,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusGForces",
                "threshold": 0,
                "excitement": 40960,
                "intensity": 34555,
                "nausea": 49648
            },
            {
                "type": "bonusTurns",
                "threshold": 0,
                "excitement": 26749,
                "intensity": 43458,
                "nausea": 45749
            },
            {
                "type": "bonusDrops",
                "threshold": 0,
                "excitement": 40777,
                "intensity": 46811,
                "nausea": 49152
            },
            {
                "type": "bonusSheltered",
                "threshold": 0,
                "excitement": 16705,
                "intensity": 30583,
                "nausea": 35108
            },
            {
                "type": "bonusReversedTrains",
                "threshold": 0,
                "excitement": 2,
                "intensity": 12,
                "nausea": 22
            },
            {
                "type": "bonusProximity",
                "threshold": 0,
                "excitement": 22367,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "bonusScenery",
                "threshold": 0,
                "excitement": 11155,
                "intensity": 0,
                "nausea": 0
            },
            {
                "type": "requirementDropHeight",
                "threshold": 12,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementMaxSpeed",
                "threshold": 655360,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNegativeGs",
                "threshold": 10,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementLength",
                "threshold": 24248320,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "requirementNumDrops",
                "threshold": 2,
                "excitement": 2,
                "intensity": 2,
                "nausea": 2
            },
            {
                "type": "penaltyLateralGs",
                "threshold": 0,
                "excitement": 40960,
                "intensity": 34555,
                "nausea": 49648
            }
        ],
        "hasAirTime": true,
        "hasGForces": true,
        "heights": {
            "maxHeight": 24,
            "clearanceHeight": 24,
            "vehicleZOffset": 8,
            "platformHeight": 11
        }
    }
};

/** Rangs des énumérations de drapeaux utiles au calcul (FlagHolder : bit = 1 << rang). */
export const RATING_FLAGS = {
    "rideFlag": {
        "onTrack": 0,
        "tested": 1,
        "testInProgress": 2,
        "noRawStats": 3,
        "passStationNoStopping": 4,
        "onRidePhoto": 5,
        "breakdownPending": 6,
        "brokenDown": 7,
        "dueInspection": 8,
        "queueFull": 9,
        "crashed": 10,
        "hasStalledVehicle": 11,
        "everBeenOpened": 12,
        "music": 13,
        "indestructible": 14,
        "indestructibleTrack": 15,
        "cableLiftHillComponentUsed": 16,
        "cableLift": 17,
        "notCustomDesign": 18,
        "sixFlagsDeprecated": 19,
        "fixedRatings": 20,
        "randomShopColours": 21,
        "reversedTrains": 22
    },
    "rideEntryFlag": {
        "tabIconIsHalfScale": 0,
        "noInversions": 1,
        "noBankedTrack": 2,
        "playDepartSound": 3,
        "inverterShipSwingMode": 4,
        "hasTwistRotationType": 5,
        "hasEnterpriseRotationType": 6,
        "disableWanderingDeprecated": 7,
        "playSplashSound": 8,
        "coveredTrackIsWaterChannel": 9,
        "isACoveredRide": 10,
        "limitAirTimeBonus": 11,
        "separateRideNameDeprecated": 12,
        "separateRideDeprecated": 13,
        "cannotBreakDown": 14,
        "disableLastOperatingModeDeprecated": 15,
        "disableDoorConstructionDeprecated": 16,
        "disableFirstTwoOperatingModesDeprecated": 17,
        "disableCollisionCrashes": 18,
        "disableColourTab": 19,
        "magicCarpetSwingMode": 20,
        "riderControlsSpeed": 21,
        "hideEmptyTrains": 22,
        "noReverseOption": 23
    }
} as const;
