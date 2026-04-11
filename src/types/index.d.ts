/**
 * @typedef {'pending' | 'in_progress' | 'done' | 'failed'} TaskStatus
 */

/**
 * @typedef {Object} TaskNode
 * @property {string} id
 * @property {string} description
 * @property {TaskStatus} status
 * @property {TaskNode[]} subtasks
 * @property {string} [output]
 * @property {string[]} actionsIds
 */

/**
 * @typedef {Object} ToolAction
 * @property {string} id
 * @property {number} timestamp
 * @property {string} toolName
 * @property {Record<string, unknown>} input
 * @property {string} output
 * @property {string[]} relatedFiles
 * @property {boolean} [includeInBrainDump]
 * @property {'default' | 'confirmed' | 'discarded' | 'hallucinated' | 'inconsistent' | 'dead_end'} [curationStatus]
 * @property {string} [curationNote]
 * @property {number} [curatedAt]
 * @property {string} [curatedBy]
 */

/**
 * @typedef {'read' | 'write' | 'edit'} FileLastAction
 */

/**
 * @typedef {Object} FileSnapshot
 * @property {string} path
 * @property {string} hash
 * @property {string} content
 * @property {number} lastTouchedAt
 * @property {FileLastAction} lastAction
 */

/**
 * @typedef {Object} ArchDecision
 * @property {string} description
 * @property {string} reasoning
 * @property {number} timestamp
 */

/**
 * @typedef {Object} PicklejarSession
 * @property {string} sessionId
 * @property {string} projectDir
 * @property {number} createdAt
 * @property {number} lastUpdatedAt
 * @property {number} snapshotCount
 * @property {string} goal
 * @property {TaskNode[]} taskTree
 * @property {ToolAction[]} actions
 * @property {FileSnapshot[]} activeFiles
 * @property {ArchDecision[]} decisions
 * @property {string} [lastError]
 * @property {string} [lastPlannedAction]
 * @property {string} [transcriptPath]
 * @property {boolean} [ended]
 * @property {string} [agentOrigin]
 */

export {};
