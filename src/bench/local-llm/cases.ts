export interface LogRow {
  id: string
  timestamp: string
  source: 'rosout' | 'diagnostics'
  node: string
  level: string
  message: string
  values?: Record<string, string>
}

export interface BenchCase {
  id: string
  title: string
  question: string
  rows: LogRow[]
  requiredEvidenceIds: string[]
  requiredTerms: string[]
  forbiddenTerms: string[]
  expectUnsupported?: boolean
}

const sharedRows: LogRow[] = [
  {
    id: 'R001',
    timestamp: '2026-06-24T01:00:00.100Z',
    source: 'rosout',
    node: '/localization',
    level: 'INFO',
    message: 'EKF initialized with map frame.',
  },
  {
    id: 'R002',
    timestamp: '2026-06-24T01:00:03.400Z',
    source: 'rosout',
    node: '/camera/front',
    level: 'WARN',
    message: 'Frame drop detected: expected 30 fps, observed 12 fps.',
  },
  {
    id: 'R003',
    timestamp: '2026-06-24T01:00:04.100Z',
    source: 'rosout',
    node: '/planner',
    level: 'ERROR',
    message: 'Planning aborted because obstacle map is stale for 2.8 seconds.',
  },
  {
    id: 'R004',
    timestamp: '2026-06-24T01:00:04.500Z',
    source: 'rosout',
    node: '/controller',
    level: 'WARN',
    message: 'Velocity command limited by safety monitor.',
  },
  {
    id: 'R005',
    timestamp: '2026-06-24T01:00:05.000Z',
    source: 'diagnostics',
    node: '/diagnostics_agg',
    level: 'WARN',
    message: 'front_camera: high latency',
    values: { latency_ms: '180', expected_ms: '50' },
  },
  {
    id: 'R006',
    timestamp: '2026-06-24T01:00:05.300Z',
    source: 'diagnostics',
    node: '/diagnostics_agg',
    level: 'OK',
    message: 'battery: nominal',
    values: { voltage: '25.1' },
  },
  {
    id: 'R007',
    timestamp: '2026-06-24T01:00:06.800Z',
    source: 'rosout',
    node: '/map_server',
    level: 'ERROR',
    message: 'Map update timeout after 3000 ms.',
  },
  {
    id: 'R008',
    timestamp: '2026-06-24T01:00:07.200Z',
    source: 'rosout',
    node: '/planner',
    level: 'INFO',
    message: 'Recovered after receiving fresh obstacle map.',
  },
]

export const benchCases: BenchCase[] = [
  {
    id: 'cause-stale-map',
    title: 'Primary planning failure',
    question: 'ロボットが停止した主な原因候補は何ですか？根拠IDも挙げてください。',
    rows: sharedRows,
    requiredEvidenceIds: ['R003'],
    requiredTerms: ['obstacle map', 'stale'],
    forbiddenTerms: ['battery', 'motor', 'lidar'],
  },
  {
    id: 'camera-latency',
    title: 'Camera diagnostic warning',
    question: 'front camera に関する問題を日本語で簡潔に説明してください。',
    rows: sharedRows,
    requiredEvidenceIds: ['R002', 'R005'],
    requiredTerms: ['camera', 'latency'],
    forbiddenTerms: ['battery', 'map_server'],
  },
  {
    id: 'first-error',
    title: 'First ERROR row',
    question: '最初に出た ERROR はどのノードで、内容は何ですか？',
    rows: sharedRows,
    requiredEvidenceIds: ['R003'],
    requiredTerms: ['/planner', 'Planning aborted'],
    forbiddenTerms: ['R007', '/map_server'],
  },
  {
    id: 'unsupported-motor',
    title: 'Unsupported motor question',
    question: 'モータードライバ故障の原因は何ですか？',
    rows: sharedRows,
    requiredEvidenceIds: [],
    requiredTerms: [],
    forbiddenTerms: ['overcurrent', 'temperature', 'encoder', 'battery'],
    expectUnsupported: true,
  },
  {
    id: 'recovery',
    title: 'Recovery signal',
    question: '障害から復帰したことを示すログはありますか？',
    rows: sharedRows,
    requiredEvidenceIds: ['R008'],
    requiredTerms: ['Recovered', 'fresh obstacle map'],
    forbiddenTerms: ['battery'],
  },
  {
    id: 'battery-status',
    title: 'Battery status',
    question: 'バッテリーに異常はありますか？ログに基づいて答えてください。',
    rows: sharedRows,
    requiredEvidenceIds: ['R006'],
    requiredTerms: ['nominal'],
    forbiddenTerms: ['low voltage', 'overheat', 'fault'],
  },
  {
    id: 'japanese-log',
    title: 'Japanese rosout message',
    question: '非常停止に関する問題を説明してください。',
    rows: [
      {
        id: 'J001',
        timestamp: '2026-06-24T02:10:00.000Z',
        source: 'rosout',
        node: '/safety_monitor',
        level: 'ERROR',
        message: '非常停止入力が有効です。解除されるまで走行指令を破棄します。',
      },
      {
        id: 'J002',
        timestamp: '2026-06-24T02:10:02.000Z',
        source: 'rosout',
        node: '/controller',
        level: 'WARN',
        message: 'cmd_vel ignored by safety gate.',
      },
    ],
    requiredEvidenceIds: ['J001'],
    requiredTerms: ['非常停止', '走行指令'],
    forbiddenTerms: ['battery', 'camera'],
  },
  {
    id: 'diagnostic-error',
    title: 'Diagnostics ERROR',
    question: 'diagnostics で ERROR になっているコンポーネントと値を答えてください。',
    rows: [
      {
        id: 'D001',
        timestamp: '2026-06-24T03:00:00.000Z',
        source: 'diagnostics',
        node: '/diagnostics_agg',
        level: 'OK',
        message: 'imu: nominal',
        values: { temperature_c: '42' },
      },
      {
        id: 'D002',
        timestamp: '2026-06-24T03:00:04.000Z',
        source: 'diagnostics',
        node: '/diagnostics_agg',
        level: 'ERROR',
        message: 'left_wheel_encoder: no ticks received',
        values: { timeout_ms: '500', tick_rate_hz: '0' },
      },
    ],
    requiredEvidenceIds: ['D002'],
    requiredTerms: ['left_wheel_encoder', '0'],
    forbiddenTerms: ['imu', 'camera'],
  },
  {
    id: 'count-errors',
    title: 'Count ERROR rows',
    question: 'ERROR は何件ありますか？該当IDも答えてください。',
    rows: sharedRows,
    requiredEvidenceIds: ['R003', 'R007'],
    requiredTerms: ['2'],
    forbiddenTerms: ['3', '1件'],
  },
  {
    id: 'no-root-cause',
    title: 'Insufficient evidence',
    question: '根本原因を一つに断定してください。',
    rows: [
      {
        id: 'U001',
        timestamp: '2026-06-24T04:00:00.000Z',
        source: 'rosout',
        node: '/system',
        level: 'WARN',
        message: 'Multiple subsystems reported degraded status.',
      },
      {
        id: 'U002',
        timestamp: '2026-06-24T04:00:01.000Z',
        source: 'rosout',
        node: '/system',
        level: 'WARN',
        message: 'Root cause analysis data is not available in this bag.',
      },
    ],
    requiredEvidenceIds: ['U002'],
    requiredTerms: [],
    forbiddenTerms: ['camera', 'battery', 'motor', 'network'],
    expectUnsupported: true,
  },
]
