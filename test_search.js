// Mock Data
const loans = [
    { id: 1, customerName: "Rahul Sharma", bankName: "HDFC Bank", amount: 500000, status: "Disbursed" },
    { id: 2, customerName: "Priya Singh", bankName: "ICICI Bank", amount: 200000, status: "Rejected" },
    { id: 3, customerName: "Amit Verma", bankName: "Axis Bank", amount: 750000, status: "Underwriting" }
];

// The Exact Search Logic from app.js
const performSearch = (searchTerm) => {
    searchTerm = searchTerm.toString().toLowerCase().trim();

    return loans.filter(loan => {
        // Safe String Casting helper
        const safeStr = (val) => String(val || '').toLowerCase();

        const textMatch =
            safeStr(loan.customerName).includes(searchTerm) ||
            safeStr(loan.bankName).includes(searchTerm) ||
            safeStr(loan.amount).includes(searchTerm) ||
            safeStr(loan.status).includes(searchTerm);

        return textMatch;
    });
};

// Run Tests
console.log("--- Starting Search Logic Test ---");

// Test 1: Search by Name "Rahul"
const res1 = performSearch("Rahul");
console.log(`Test 1 (Name 'Rahul'): Found ${res1.length} matches. (Expected 1)`);
if (res1.length > 0) console.log(`   > Match: ${res1[0].customerName}`);

// Test 2: Search by Bank "ICICI"
const res2 = performSearch("ICICI");
console.log(`Test 2 (Bank 'ICICI'): Found ${res2.length} matches. (Expected 1)`);

// Test 3: Search by Amount "750000" (Number to String check)
const res3 = performSearch("750000");
console.log(`Test 3 (Amount '750000'): Found ${res3.length} matches. (Expected 1)`);

// Test 4: Search by Status "Disbursed"
const res4 = performSearch("disbursed");
console.log(`Test 4 (Status 'disbursed'): Found ${res4.length} matches. (Expected 1)`);

// Test 5: Partial Match "rma" (Sha*rma*, Ve*rma*)
const res5 = performSearch("rma");
console.log(`Test 5 (Partial 'rma'): Found ${res5.length} matches. (Expected 2)`);

console.log("--- Test Complete ---");
