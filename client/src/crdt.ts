// The shape of a single character node in our CRDT
export interface CRDTNode {
  id: string;        //  it's the full unique ID of that character, format: "clientID:clock"
  value: string;     // the actual character e.g. "H"
  after: string | null; // id of the character this new node comes after,
                        // null means it's the very first character or node of the line
  deleted: boolean;  // tombstone flag — hidden but never removed
}

export class CRDT {
  private clientId: string;
  private clock: number;
  private nodes: CRDTNode[];

  constructor(clientId: string) {
    this.clientId = clientId; // unique ID for this user
    this.clock = 0;           // Lamport clock starts at 0
    this.nodes = [];          // empty document to start
  }
  reset(): void {
    this.nodes = [];
    this.clock = 0;
  }
  insert(afterId: string | null, value: string): CRDTNode {
  // Step 1: Increment clock FIRST (as you correctly said!)
  this.clock++;

  // Step 2: Generate unique ID for this character
  const id = `${this.clientId}:${this.clock}`;

  // Step 3: Create the new node
  const newNode: CRDTNode = {
    id,
    value,
    after: afterId,
    deleted: false
  };

  // Step 4: Insert it into the nodes array
  this.integrate(newNode);

  return newNode; // we return it so we can send it to server later
  }
  private compareIds(a: string, b: string): number {
  const [clientA, clockA] = a.split(":");
  const [clientB, clockB] = b.split(":");
  
  // Compare clock numbers numerically first
  const clockDiff = parseInt(clockA) - parseInt(clockB);
  if (clockDiff !== 0) return clockDiff;
  
  // Same clock → compare clientIds alphabetically
  return clientA > clientB ? 1 : -1;
}
  private integrate(newNode: CRDTNode): void {
  // Step 1: Find the index of the "after" node
  // If after is null → new node goes at the very beginning
  let insertIndex = 0;

  if (newNode.after !== null) {
    const afterIndex = this.nodes.findIndex(n => n.id === newNode.after);
    insertIndex = afterIndex + 1;
    // Start looking AFTER the "after" node
  }

  // Step 2: Scan forward — skip nodes that should come before us
  // These are nodes with same "after" but higher id (they win tiebreaker)
  while (
    insertIndex < this.nodes.length &&
    this.nodes[insertIndex].after === newNode.after &&
    this.compareIds(this.nodes[insertIndex].id, newNode.id) > 0
  ) {
    insertIndex++;
  }

  // Step 3: Insert at the found position
  this.nodes.splice(insertIndex, 0, newNode);
  }

  delete(id: string): void {
  const node = this.nodes.find(n => n.id === id);
  if (node) {
    node.deleted = true;
  }
  }

  toString(): string {
  return this.nodes
    .filter(n => n.deleted === false)  // keep non-deleted
    .map(n => n.value)                 // extract characters
    .join("");                         // join into string
  }
  //insert() → for YOUR OWN typing → generates new id
  //merge()  → for OTHERS' typing → preserves original id
  merge(node: CRDTNode): void {
  // Check if we already have this node (avoid duplicates)
  const exists = this.nodes.some(n => n.id === node.id);
  if (!exists) {
    // Update our Lamport clock!
    // Remember Rule 2: max(ours, theirs) + 1
    this.clock = Math.max(this.clock, parseInt(node.id.split(":")[1])) + 1;
    this.integrate(node);
  }
  }

  getVisibleNodes(): CRDTNode[] {
  return this.nodes.filter(n => n.deleted === false);
  }
}
