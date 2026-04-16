import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../supabase";
import "./admin.css";

export default function AdminPayroll() {
  const [payrollData, setPayrollData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterMonth, setFilterMonth] = useState(new Date().getMonth() + 1);
  const [filterYear, setFilterYear] = useState(new Date().getFullYear());
  const [releasing, setReleasing] = useState(false);

  // Edit Modal States
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingEmp, setEditingEmp] = useState(null);

  const getMonthName = (monthNumber) => {
    const date = new Date();
    date.setMonth(monthNumber - 1);
    return date.toLocaleString("en-US", { month: "long" });
  };

  const getLastDayOfMonth = (year, month) => {
    return new Date(year, month, 0).getDate();
  };

  const fetchPayroll = useCallback(async () => {
    try {
      setLoading(true);
      // 1. Fetch Employees
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

      // 2. Fetch Attendance, Leaves, and Reimbursements
      const [attRes, leaveRes, reimbRes] = await Promise.all([
        supabase.from("attendance").select("*").gte("date", startDate).lte("date", endDate),
        supabase.from("leaves").select("*").eq("status", "Approved").gte("start_date", startDate).lte("end_date", endDate),
        // Assuming you have a reimbursements table; if not, it defaults to 0
        supabase.from("reimbursements").select("*").eq("status", "Approved").gte("date", startDate).lte("date", endDate),
      ]);

      if (attRes.error) throw attRes.error;
      if (leaveRes.error) throw leaveRes.error;

      // 3. Process Data
      const processedData = (employees || []).map((emp) => {
        const empAttendance = (attRes.data || []).filter((a) => a.employee_id === emp.id);
        const presentDays = empAttendance.filter((a) => a.status === "Present" || a.status === "Late").length;
        
        const halfDays = (leaveRes.data || []).filter((l) => 
          l.employee_id === emp.id && (l.leave_type === "Half Day" || l.leave_type === "Permission")
        ).length;

        // Calculate total reimbursements for this employee
        const empReimbursements = (reimbRes.data || [])
          .filter((r) => r.employee_id === emp.id)
          .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

        const totalPayableDays = presentDays + (halfDays * 0.5);
        const salaryValue = Number(emp.base_salary) || 0;
        const dailyRate = salaryValue / 30;
        
        const insurance = 0; 
        
        const grossEarnings = Math.round(dailyRate * totalPayableDays);
        // Formula: (Gross - Insurance) + Reimbursement
        const netSalary = (grossEarnings - insurance) + empReimbursements;

        return {
          ...emp,
          fullName: `${emp.first_name || ""} ${emp.last_name || ""}`.trim(),
          payableDays: totalPayableDays,
          presentCount: presentDays,
          halfDayCount: halfDays,
          insurance_deduction: insurance,
          reimbursement_amount: empReimbursements,
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

  const handleEditChange = (field, value) => {
    const updatedEmp = { ...editingEmp, [field]: value };
    
    if (['base_salary', 'presentCount', 'halfDayCount', 'insurance_deduction', 'reimbursement_amount'].includes(field)) {
      const base = Number(updatedEmp.base_salary) || 0;
      const pres = Number(updatedEmp.presentCount) || 0;
      const half = Number(updatedEmp.halfDayCount) || 0;
      const ins = Number(updatedEmp.insurance_deduction) || 0;
      const reimb = Number(updatedEmp.reimbursement_amount) || 0;
      
      updatedEmp.payableDays = pres + (half * 0.5);
      const gross = Math.round((base / 30) * updatedEmp.payableDays);
      updatedEmp.calculatedSalary = (gross - ins) + reimb;
    }
    setEditingEmp(updatedEmp);
  };

  const saveEdit = () => {
    setPayrollData((prev) => prev.map((emp) => (emp.id === editingEmp.id ? editingEmp : emp)));
    setIsEditModalOpen(false);
  };

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
        insurance_deduction: record.insurance_deduction,
        reimbursement_amount: record.reimbursement_amount,
        status: "Released",
        released_at: new Date().toISOString()
      }));

      const { error } = await supabase.from("payroll_history").upsert(payload, {
        onConflict: 'employee_id, month, year' 
      });

      if (error) throw error;
      alert("Salary released successfully!");
    } catch (err) {
      alert("Error: " + err.message);
    } finally {
      setReleasing(false);
    }
  };

  const handleDownloadSlip = (emp) => {
    const monthNameShort = getMonthName(filterMonth).substring(0, 3);
    const printDate = new Date().toLocaleString("en-GB", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });

    const dailyRate = (Number(emp.base_salary) || 0) / 30;
    const attendanceEarnings = Math.round(dailyRate * emp.payableDays);

    const printWindow = window.open("", "_blank");
    printWindow.document.write(`
      <html>
        <head>
          <title>Payslip - ${emp.fullName}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 10px; color: #000; font-size: 11px; }
            .container { border: 1px solid #000; padding: 20px; max-width: 850px; margin: auto; }
            .brand { font-size: 24px; font-weight: bold; margin: 0; }
            .co-name { font-weight: bold; font-size: 13px; margin: 2px 0; }
            .address { font-size: 10px; margin: 0; width: 75%; line-height: 1.3; }
            .title { text-align: center; font-weight: bold; font-size: 14px; margin: 15px 0; border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 5px 0; }
            .info-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
            .info-table td { border: 1px solid #ccc; padding: 6px; width: 25%; height: 25px; }
            .label { font-weight: bold; background-color: #f2f2f2; }
            .salary-table { width: 100%; border-collapse: collapse; }
            .salary-table th { border: 1px solid #000; padding: 6px; background-color: #f2f2f2; text-align: left; }
            .salary-table td { border: 1px solid #000; padding: 8px; vertical-align: top; }
            .footer { margin-top: 30px; font-size: 10px; }
            @media print { .no-print { display: none; } }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="brand">Cerevyn</div>
            <div class="co-name">Cerevyn Solutions Private Limited</div>
            <p class="address">Shaikpet, Hyderabad-500081, Telangana</p>
            <div class="title">Payslip for the month of ${monthNameShort} ${filterYear}</div>
            <table class="info-table">
              <tr><td class="label">Name:</td><td>${emp.fullName}</td><td class="label">Employee No:</td><td>${emp.employee_id || ""}</td></tr>
              <tr><td class="label">Joining Date:</td><td>${emp.joining_date || ""}</td><td class="label">Bank Name:</td><td>${emp.bank_name || ""}</td></tr>
              <tr><td class="label">Designation:</td><td>${emp.designation || ""}</td><td class="label">Bank Account No:</td><td>${emp.bank_account || ""}</td></tr>
              <tr><td class="label">Department:</td><td>${emp.department || ""}</td><td class="label">PAN Number:</td><td>${emp.pan_no || ""}</td></tr>
              <tr><td class="label">Location:</td><td>Hyderabad</td><td class="label">Effective Work Days:</td><td>${emp.payableDays}</td></tr>
            </table>
            <table class="salary-table">
              <thead><tr><th colspan="2">Earnings</th><th colspan="2">Deductions</th></tr></thead>
              <tbody>
                <tr style="height: 120px;">
                  <td>
                    Basic Monthly Salary: ₹${(Number(emp.base_salary) || 0).toLocaleString()}<br/>
                    Attendance Pay: ₹${attendanceEarnings.toLocaleString()}<br/>
                    Reimbursements: ₹${(Number(emp.reimbursement_amount) || 0).toLocaleString()}
                  </td>
                  <td><br/>--<br/>--</td>
                  <td>Insurance Deduction<br/>LOP (Loss of Pay)</td>
                  <td>₹${(Number(emp.insurance_deduction) || 0).toLocaleString()}<br/>₹0</td>
                </tr>
                <tr style="font-weight: bold; background: #f2f2f2;">
                  <td>Total Earnings (Incl. Reimb)</td><td>₹${(attendanceEarnings + (Number(emp.reimbursement_amount) || 0)).toLocaleString()}</td>
                  <td>Total Deductions</td><td>₹${(Number(emp.insurance_deduction) || 0).toLocaleString()}</td>
                </tr>
                <tr style="font-weight: bold;"><td colspan="3" style="text-align: right; padding-right: 20px;">Net Payable Amount:</td><td>₹${emp.calculatedSalary.toLocaleString()}</td></tr>
              </tbody>
            </table>
            <div class="footer">This is a system generated payslip and does not require signature.<br/>Print Date: ${printDate}</div>
          </div>
          <div style="text-align:center; margin-top:20px;" class="no-print">
            <button onclick="window.print()" style="padding:10px 25px; background:#10b981; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold;">Download PDF</button>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  return (
    <div className="admin-attendance-container">
      <div className="attendance-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 className="attendance-title">Payroll Monitor</h2>
        <div className="payroll-controls" style={{ display: "flex", gap: "10px" }}>
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
            {releasing ? "Processing..." : "Release All"}
          </button>
        </div>
      </div>

      <div className="table-wrapper">
        <table className="attendance-table">
          <thead>
            <tr>
              <th>Employee Name</th>
              <th>Monthly Base</th>
              <th>Reimbursement</th>
              <th>Insurance</th>
              <th>Net Salary</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="6">Calculating...</td></tr>
            ) : (
              payrollData.map((emp) => (
                <tr key={emp.id}>
                  <td style={{ fontWeight: "600" }}>{emp.fullName}</td>
                  <td>₹{Number(emp.base_salary || 0).toLocaleString()}</td>
                  <td style={{ color: "#3b82f6" }}>+₹{Number(emp.reimbursement_amount || 0).toLocaleString()}</td>
                  <td style={{ color: "#ef4444" }}>-₹{Number(emp.insurance_deduction || 0).toLocaleString()}</td>
                  <td style={{ color: "#10b981", fontWeight: "bold" }}>₹{emp.calculatedSalary.toLocaleString()}</td>
                  <td style={{ display: "flex", gap: "5px" }}>
                    <button className="edit-btn" style={{ background: "#3b82f6" }} onClick={() => { setEditingEmp(emp); setIsEditModalOpen(true); }}>Edit</button>
                    <button className="edit-btn" onClick={() => handleDownloadSlip(emp)}>Slip</button>
                    <button className="edit-btn" style={{ background: "#f59e0b" }} onClick={() => releaseSalary(emp)}>Release</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {isEditModalOpen && editingEmp && (
        <div style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#1e293b", padding: "30px", borderRadius: "10px", width: "400px", color: "white" }}>
            <h3>Edit Payroll: {editingEmp.fullName}</h3>
            <div style={{ marginTop: "15px" }}>
              <label style={{ fontSize: "12px", color: "#94a3b8" }}>Base Salary (₹)</label>
              <input type="number" style={{ width: "100%", padding: "8px" }} value={editingEmp.base_salary} onChange={(e) => handleEditChange("base_salary", e.target.value)} />
            </div>
            <div style={{ marginTop: "15px" }}>
              <label style={{ fontSize: "12px", color: "#94a3b8" }}>Reimbursement Amount (₹)</label>
              <input type="number" style={{ width: "100%", padding: "8px", border: "1px solid #3b82f6" }} value={editingEmp.reimbursement_amount} onChange={(e) => handleEditChange("reimbursement_amount", e.target.value)} />
            </div>
            <div style={{ marginTop: "15px" }}>
              <label style={{ fontSize: "12px", color: "#94a3b8" }}>Insurance Deduction (₹)</label>
              <input type="number" style={{ width: "100%", padding: "8px", border: "1px solid #ef4444" }} value={editingEmp.insurance_deduction} onChange={(e) => handleEditChange("insurance_deduction", e.target.value)} />
            </div>
            <div style={{ marginTop: "15px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div>
                <label style={{ fontSize: "12px", color: "#94a3b8" }}>Present Days</label>
                <input type="number" style={{ width: "100%", padding: "8px" }} value={editingEmp.presentCount} onChange={(e) => handleEditChange("presentCount", e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: "12px", color: "#94a3b8" }}>Half-Days</label>
                <input type="number" style={{ width: "100%", padding: "8px" }} value={editingEmp.halfDayCount} onChange={(e) => handleEditChange("halfDayCount", e.target.value)} />
              </div>
            </div>
            <div style={{ marginTop: "20px", background: "#0f172a", padding: "10px" }}>
              <p>Net Salary: <strong style={{ color: "#10b981" }}>₹{editingEmp.calculatedSalary.toLocaleString()}</strong></p>
            </div>
            <div style={{ marginTop: "20px", display: "flex", gap: "10px" }}>
              <button onClick={saveEdit} style={{ flex: 1, background: "#10b981", color: "white", border: "none", padding: "10px", borderRadius: "4px" }}>Save</button>
              <button onClick={() => setIsEditModalOpen(false)} style={{ flex: 1, background: "#ef4444", color: "white", border: "none", padding: "10px", borderRadius: "4px" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}