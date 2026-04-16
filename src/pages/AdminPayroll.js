import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../supabase";
import "./admin.css";

export default function AdminPayroll() {
  // ===== 1. STATE MANAGEMENT =====
  const [payrollData, setPayrollData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterMonth, setFilterMonth] = useState(new Date().getMonth() + 1);
  const [filterYear, setFilterYear] = useState(new Date().getFullYear());
  const [releasing, setReleasing] = useState(false);

  // Edit Modal States
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingEmp, setEditingEmp] = useState(null);

  // ===== 2. DATE HELPERS =====
  const getMonthName = (monthNumber) => {
    const date = new Date();
    date.setMonth(monthNumber - 1);
    return date.toLocaleString("en-US", { month: "long" });
  };

  const getLastDayOfMonth = (year, month) => {
    return new Date(year, month, 0).getDate();
  };

  // ===== 3. DATA FETCHING & MERGE LOGIC =====
  const fetchPayroll = useCallback(async () => {
    try {
      setLoading(true);
      
      const { data: employees, error: empError } = await supabase
        .from("employees")
        .select(`
          id, first_name, last_name, base_salary, joining_date, department, 
          employee_id, designation, bank_name, bank_account, ifsc_code, pan_no, adhar_number
        `);

      if (empError) throw empError;

      const lastDay = getLastDayOfMonth(filterYear, filterMonth);
      const startDate = `${filterYear}-${String(filterMonth).padStart(2, "0")}-01`;
      const endDate = `${filterYear}-${String(filterMonth).padStart(2, "0")}-${lastDay}`;

      const [attRes, leaveRes, reimbRes] = await Promise.all([
        supabase.from("attendance").select("*").gte("date", startDate).lte("date", endDate),
        supabase.from("leaves").select("*").eq("status", "Approved").gte("start_date", startDate).lte("end_date", endDate),
        supabase.from("reimbursements").select("*").eq("status", "Approved").gte("date", startDate).lte("date", endDate).catch(() => ({ data: [] }))
      ]);

      if (attRes.error) throw attRes.error;
      if (leaveRes.error) throw leaveRes.error;

      const processedData = (employees || []).map((emp) => {
        const match = (item) => item.employee_id === emp.id || item.employee_id === emp.employee_id;

        const empAttendance = (attRes.data || []).filter(match);
        const presentDays = empAttendance.filter((a) => a.status === "Present" || a.status === "Late").length;
        
        const halfDays = (leaveRes.data || []).filter((l) => 
          match(l) && (l.leave_type === "Half Day" || l.leave_type === "Permission")
        ).length;

        const empReimb = (reimbRes.data || []).filter(match);
        const totalReimbursement = empReimb.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

        const totalPayableDays = presentDays + (halfDays * 0.5);
        const salaryValue = Number(emp.base_salary) || 0;
        const dailyRate = salaryValue / 30;
        
        const insurance = 0; 
        const grossEarnings = Math.round(dailyRate * totalPayableDays);
        const netSalary = (grossEarnings + totalReimbursement) - insurance;

        return {
          ...emp,
          fullName: `${emp.first_name || ""} ${emp.last_name || ""}`.trim(),
          payableDays: totalPayableDays,
          presentCount: presentDays,
          halfDayCount: halfDays,
          reimbursement: totalReimbursement,
          insurance_deduction: insurance,
          calculatedSalary: netSalary,
        };
      });

      setPayrollData(processedData);
    } catch (err) {
      console.error("Payroll Fetch Error:", err.message);
    } finally {
      setLoading(false);
    }
  }, [filterMonth, filterYear]);

  useEffect(() => {
    fetchPayroll();
  }, [fetchPayroll]);

  // ===== 4. EDIT LOGIC =====
  const handleEditChange = (field, value) => {
    const updatedEmp = { ...editingEmp, [field]: value };
    
    if (['base_salary', 'presentCount', 'halfDayCount', 'insurance_deduction', 'reimbursement'].includes(field)) {
      const base = Number(updatedEmp.base_salary) || 0;
      const pres = Number(updatedEmp.presentCount) || 0;
      const half = Number(updatedEmp.halfDayCount) || 0;
      const ins = Number(updatedEmp.insurance_deduction) || 0;
      const reimb = Number(updatedEmp.reimbursement) || 0;
      
      updatedEmp.payableDays = pres + (half * 0.5);
      const gross = Math.round((base / 30) * updatedEmp.payableDays);
      updatedEmp.calculatedSalary = (gross + reimb) - ins;
    }
    setEditingEmp(updatedEmp);
  };

  const saveEdit = () => {
    setPayrollData((prev) => prev.map((emp) => (emp.id === editingEmp.id ? editingEmp : emp)));
    setIsEditModalOpen(false);
  };

  // ===== 5. RELEASE LOGIC =====
  const releaseSalary = async (emp = null) => {
    const confirmMsg = emp 
      ? `Release salary for ${emp.fullName}?` 
      : `Release salary for ALL employees for ${getMonthName(filterMonth)} ${filterYear}?`;

    if (!window.confirm(confirmMsg)) return;

    try {
      setReleasing(true);
      const recordsToRelease = emp ? [emp] : payrollData;
      
      const payload = recordsToRelease.map(record => ({
        employee_id: record.id,
        month: filterMonth,
        year: filterYear,
        amount_paid: record.calculatedSalary,
        reimbursement: record.reimbursement,
        insurance_deduction: record.insurance_deduction,
        status: "Released",
        released_at: new Date().toISOString()
      }));

      const { error } = await supabase.from("payroll_history").upsert(payload, {
        onConflict: 'employee_id, month, year' 
      });

      if (error) throw error;
      alert("Salary release successful!");
    } catch (err) {
      alert("Error: " + err.message);
    } finally {
      setReleasing(false);
    }
  };

  // ===== 6. PAYSLIP GENERATOR (Warning Fixed Here) =====
  const handleDownloadSlip = (emp) => {
    const monthNameShort = getMonthName(filterMonth).substring(0, 3).toUpperCase();
    const printDate = new Date().toLocaleString("en-GB", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });

    const totalEarnings = emp.calculatedSalary + (Number(emp.insurance_deduction) || 0);

    const printWindow = window.open("", "_blank");
    printWindow.document.write(`
      <html>
        <head>
          <title>Payslip - ${emp.fullName}</title>
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; color: #333; font-size: 11px; line-height: 1.4; }
            .container { border: 1px solid #111; padding: 30px; max-width: 800px; margin: auto; background: #fff; }
            .brand { font-size: 26px; font-weight: bold; margin: 0; color: #1e293b; }
            .title { text-align: center; font-weight: bold; font-size: 14px; margin: 20px 0; border-top: 2px solid #333; border-bottom: 2px solid #333; padding: 6px 0; background: #f8fafc; }
            .info-table { width: 100%; border-collapse: collapse; margin-bottom: 25px; }
            .info-table td { border: 1px solid #e2e8f0; padding: 8px; width: 25%; }
            .label { font-weight: bold; background-color: #f1f5f9; }
            .salary-table { width: 100%; border-collapse: collapse; }
            .salary-table th { border: 1px solid #111; padding: 8px; background-color: #f1f5f9; text-align: left; }
            .salary-table td { border: 1px solid #111; padding: 10px; vertical-align: top; }
            .footer { margin-top: 40px; font-size: 10px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 10px; }
            @media print { .no-print { display: none; } }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="brand">Cerevyn</div>
            <div style="font-weight:700">Cerevyn Solutions Private Limited</div>
            <p>Shaikpet, Hyderabad-500081, Telangana</p>
            <div class="title">PAYSLIP: ${monthNameShort} ${filterYear}</div>
            <table class="info-table">
              <tr><td class="label">Employee Name:</td><td>${emp.fullName}</td><td class="label">Emp ID:</td><td>${emp.employee_id || "N/A"}</td></tr>
              <tr><td class="label">Designation:</td><td>${emp.designation || ""}</td><td class="label">Department:</td><td>${emp.department || ""}</td></tr>
              <tr><td class="label">Bank Name:</td><td>${emp.bank_name || ""}</td><td class="label">Account No:</td><td>${emp.bank_account || ""}</td></tr>
              <tr><td class="label">PAN:</td><td>${emp.pan_no || ""}</td><td class="label">Effective Days:</td><td>${emp.payableDays}</td></tr>
            </table>
            <table class="salary-table">
              <thead><tr><th colspan="2">EARNINGS</th><th colspan="2">DEDUCTIONS</th></tr></thead>
              <tbody>
                <tr style="height: 140px;">
                  <td>Basic Salary<br/>Attendance Payout<br/>Approved Reimbursements<br/>Misc.</td>
                  <td style="text-align: right;">₹${(Number(emp.base_salary) || 0).toLocaleString()}<br/>--<br/>₹${(Number(emp.reimbursement) || 0).toLocaleString()}<br/>₹0</td>
                  <td>Insurance<br/>Tax/LOP</td>
                  <td style="text-align: right;">₹${(Number(emp.insurance_deduction) || 0).toLocaleString()}<br/>₹0</td>
                </tr>
                <tr style="font-weight: bold; background: #f8fafc;">
                  <td>Total Gross</td><td style="text-align: right;">₹${totalEarnings.toLocaleString()}</td>
                  <td>Total Deductions</td><td style="text-align: right;">₹${(Number(emp.insurance_deduction) || 0).toLocaleString()}</td>
                </tr>
                <tr style="font-weight: bold; background: #f1f5f9;">
                  <td colspan="3" style="text-align: right;">NET PAYABLE:</td><td style="text-align: right;">₹${emp.calculatedSalary.toLocaleString()}</td>
                </tr>
              </tbody>
            </table>
            <div class="footer">Computer generated slip. No signature required.<br/>Generated on: ${printDate}</div>
          </div>
          <div style="text-align:center; margin-top:20px;" class="no-print">
            <button onclick="window.print()" style="padding:12px 30px; background:#10b981; color:white; border:none; border-radius:6px; cursor:pointer; font-weight:bold;">Download PDF</button>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  return (
    <div className="admin-attendance-container">
      <div className="attendance-header">
        <h2 className="attendance-title">Payroll Monitor</h2>
        <div className="payroll-controls">
          <select value={filterMonth} onChange={(e) => setFilterMonth(Number(e.target.value))}>
            {[...Array(12)].map((_, i) => (
              <option key={i + 1} value={i + 1}>{getMonthName(i + 1)}</option>
            ))}
          </select>
          <select value={filterYear} onChange={(e) => setFilterYear(Number(e.target.value))}>
            {[2024, 2025, 2026].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button className="filter-btn" onClick={fetchPayroll}>Refresh</button>
          <button className="filter-btn" style={{ background: "#f59e0b" }} onClick={() => releaseSalary()} disabled={releasing}>
            {releasing ? "Syncing..." : "Release All"}
          </button>
        </div>
      </div>

      <div className="table-wrapper">
        <table className="attendance-table">
          <thead>
            <tr>
              <th>Employee Name</th>
              <th>Base Salary</th>
              <th>Reimb.</th>
              <th>Deductions</th>
              <th>Net Total</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="6">Processing calculations...</td></tr>
            ) : (
              payrollData.map((emp) => (
                <tr key={emp.id}>
                  <td style={{ fontWeight: "600" }}>{emp.fullName}</td>
                  <td>₹{Number(emp.base_salary || 0).toLocaleString()}</td>
                  <td style={{ color: "#3b82f6" }}>+₹{Number(emp.reimbursement || 0).toLocaleString()}</td>
                  <td style={{ color: "#ef4444" }}>-₹{Number(emp.insurance_deduction || 0).toLocaleString()}</td>
                  <td style={{ color: "#10b981", fontWeight: "bold" }}>₹{emp.calculatedSalary.toLocaleString()}</td>
                  <td>
                    <div className="action-group">
                      <button className="edit-btn" style={{ background: "#3b82f6" }} onClick={() => { setEditingEmp(emp); setIsEditModalOpen(true); }}>Edit</button>
                      <button className="edit-btn" onClick={() => handleDownloadSlip(emp)}>Slip</button>
                      <button className="edit-btn" style={{ background: "#f59e0b" }} onClick={() => releaseSalary(emp)}>Release</button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {isEditModalOpen && editingEmp && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>Modify Payroll: {editingEmp.fullName}</h3>
            
            <div className="modal-field">
              <label>Monthly Base (₹)</label>
              <input type="number" value={editingEmp.base_salary} onChange={(e) => handleEditChange("base_salary", e.target.value)} />
            </div>

            <div className="modal-field">
              <label>Approved Reimbursement (₹)</label>
              <input type="number" value={editingEmp.reimbursement} onChange={(e) => handleEditChange("reimbursement", e.target.value)} />
            </div>

            <div className="modal-field">
              <label>Insurance Deduction (₹)</label>
              <input type="number" value={editingEmp.insurance_deduction} onChange={(e) => handleEditChange("insurance_deduction", e.target.value)} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div className="modal-field">
                <label>Present Days</label>
                <input type="number" value={editingEmp.presentCount} onChange={(e) => handleEditChange("presentCount", e.target.value)} />
              </div>
              <div className="modal-field">
                <label>Half-Days</label>
                <input type="number" value={editingEmp.halfDayCount} onChange={(e) => handleEditChange("halfDayCount", e.target.value)} />
              </div>
            </div>

            <div className="modal-summary">
              <p>Net Salary: <strong>₹{editingEmp.calculatedSalary.toLocaleString()}</strong></p>
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
              <button onClick={saveEdit} style={{ flex: 1, background: "#10b981", color: "white", padding: "12px", border: "none", borderRadius: "8px", fontWeight: "bold" }}>Save</button>
              <button onClick={() => setIsEditModalOpen(false)} style={{ flex: 1, background: "#ef4444", color: "white", padding: "12px", border: "none", borderRadius: "8px", fontWeight: "bold" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}