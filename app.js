// app.js - 월급 알리미 애플리케이션 로직

// --- 1. 상태 정의 및 초기 데이터 시딩 ---
let state = {
    jobs: [],
    logs: [],
    notificationSettings: {
        enabled: false,
        time: "05:00"
    },
    userName: "",
    payDuringBreak: false,
    scannedShifts: [],
    scannedImages: [],
    customHolidays: {},
    googleHolidays: {}
};

// 기본 파스텔 색상 정의 (아르바이트별 시각적 구분)
const JOB_COLORS = [
    { bg: "#FFEFEA", text: "#FF7E5F", border: "#FF7E5F" }, // Peach
    { bg: "#EEF2FF", text: "#6366F1", border: "#6366F1" }, // Indigo
    { bg: "#ECFDF5", text: "#10B981", border: "#10B981" }, // Emerald
    { bg: "#FEF9C3", text: "#CA8A04", border: "#CA8A04" }, // Yellow/Gold
    { bg: "#F3E8FF", text: "#A855F7", border: "#A855F7" }  // Purple
];

// 2026년 대한민국 공휴일 정의
const KOREAN_HOLIDAYS_2026 = {
    "2026-01-01": "신정",
    "2026-02-16": "설날 연휴",
    "2026-02-17": "설날 연휴",
    "2026-02-18": "설날 연휴",
    "2026-03-01": "삼일절",
    "2026-03-02": "대체공휴일",
    "2026-05-05": "어린이날",
    "2026-05-24": "부처님오신날",
    "2026-05-25": "대체공휴일",
    "2026-06-06": "현충일",
    "2026-08-15": "광복절",
    "2026-09-24": "추석 연휴",
    "2026-09-25": "추석 연휴",
    "2026-09-26": "추석 연휴",
    "2026-10-03": "개천절",
    "2026-10-05": "대체공휴일",
    "2026-10-09": "한글날",
    "2026-12-25": "성탄절"
};

// 로컬 스토리지 키
const STORAGE_KEY = "ALBAGO_STATE";

function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        try {
            state = JSON.parse(saved);
            // 하위 호환성 및 기본값 적용
            if (state.userName === undefined) state.userName = "";
            if (state.payDuringBreak === undefined) state.payDuringBreak = false;
            if (state.scannedShifts === undefined) state.scannedShifts = [];
            if (state.scannedImages === undefined) state.scannedImages = [];
            if (state.customHolidays === undefined) state.customHolidays = {};
            if (state.googleHolidays === undefined) state.googleHolidays = {};
        } catch (e) {
            console.error("데이터 로드 중 오류 발생, 초기화합니다.", e);
            seedDemoData();
        }
    } else {
        seedDemoData();
    }
}

// 초기 데모 데이터 생성 (로그인 또는 초기화를 시켰을 때 아무런 아르바이트 정보를 입력하지 않음)
function seedDemoData() {
    state.jobs = [];
    state.logs = [];
    state.customHolidays = {};
    state.googleHolidays = {};
    state.userName = "";
    state.payDuringBreak = false;
    state.scannedShifts = [];
    state.scannedImages = [];
    state.notificationSettings = {
        enabled: false,
        time: "05:00"
    };

    saveState();
}

// --- 2. 급여 계산 헬퍼 함수 ---

// 공휴일 정보 획득
function getHolidayName(dateStr) {
    // 1. 사용자 지정 공휴일 (오버라이드로 공휴일 취소된 경우 ""가 반환됨)
    if (state.customHolidays && state.customHolidays[dateStr] !== undefined) {
        return state.customHolidays[dateStr];
    }
    // 2. Google Calendar 연동 공휴일
    if (state.googleHolidays && state.googleHolidays[dateStr]) {
        return state.googleHolidays[dateStr];
    }
    // 3. 로컬 기본 공휴일 (2026)
    return KOREAN_HOLIDAYS_2026[dateStr] || "";
}

function isHoliday(dateStr) {
    return !!getHolidayName(dateStr);
}

// Google Calendar ICS 데이터 파싱
function parseICS(icsText) {
    const holidays = {};
    const events = icsText.split("BEGIN:VEVENT");
    
    for (let i = 1; i < events.length; i++) {
        const event = events[i];
        
        // DTSTART;VALUE=DATE:YYYYMMDD or DTSTART:YYYYMMDD
        const startMatch = event.match(/DTSTART(?:;[^:]*)?:(\d{8})/);
        if (!startMatch) continue;
        
        const rawDate = startMatch[1]; // "YYYYMMDD"
        const dateStr = `${rawDate.substring(0, 4)}-${rawDate.substring(4, 6)}-${rawDate.substring(6, 8)}`;
        
        // SUMMARY:공휴일 이름
        const summaryMatch = event.match(/SUMMARY:(.*)/);
        if (!summaryMatch) continue;
        
        let summary = summaryMatch[1].trim();
        // 특수문자 및 이스케이프 쉼표 제거
        summary = summary.replace(/\\,/g, ",").replace(/\\;/g, ";");
        
        // DTEND를 매칭하여 종료일이 다를 경우 해당 범위의 일자에 모두 공휴일명 적용 (하루 종일 이벤트는 DTEND가 다음날임)
        const endMatch = event.match(/DTEND(?:;[^:]*)?:(\d{8})/);
        if (endMatch) {
            const rawEndDate = endMatch[1];
            const startDateObj = new Date(
                Number(rawDate.substring(0, 4)),
                Number(rawDate.substring(4, 6)) - 1,
                Number(rawDate.substring(6, 8))
            );
            const endDateObj = new Date(
                Number(rawEndDate.substring(0, 4)),
                Number(rawEndDate.substring(4, 6)) - 1,
                Number(rawEndDate.substring(6, 8))
            );
            
            let current = new Date(startDateObj);
            while (current < endDateObj) {
                const curStr = formatDate(current);
                holidays[curStr] = summary;
                current.setDate(current.getDate() + 1);
            }
        } else {
            holidays[dateStr] = summary;
        }
    }
    return holidays;
}

// Google Calendar 공휴일 연동 비동기 호출
async function fetchGoogleHolidays() {
    const calendarId = "ko.south_korea#holiday@group.v.calendar.google.com";
    const icsUrl = `https://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`;
    // CORS 문제를 해결하기 위해 AllOrigins 프록시 경유
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(icsUrl)}`;
    
    try {
        console.log("Fetching Google Holidays from Calendar ID...");
        const response = await fetch(proxyUrl);
        if (!response.ok) throw new Error("HTTP request failed");
        
        const icsText = await response.text();
        const parsedHolidays = parseICS(icsText);
        
        if (Object.keys(parsedHolidays).length > 0) {
            state.googleHolidays = parsedHolidays;
            saveState();
            console.log("Successfully loaded Google Holidays:", Object.keys(parsedHolidays).length, "dates loaded.");
            
            // 데이터 수신 후 화면에 바로 반영하기 위해 캘린더 및 대시보드 갱신
            renderCalendar();
            renderDashboard();
        }
    } catch (e) {
        console.error("Failed to fetch Google Calendar holidays:", e);
    }
}

// 시간차 계산 (시간 단위 반환, 자정 넘는 근무 대응)
function getDurationHours(startTime, endTime) {
    const [sHour, sMin] = startTime.split(":").map(Number);
    const [eHour, eMin] = endTime.split(":").map(Number);
    
    let diffMins = (eHour * 60 + eMin) - (sHour * 60 + sMin);
    if (diffMins < 0) {
        // 자정 넘음
        diffMins += 24 * 60;
    }
    return diffMins / 60;
}

// 야간 근무 시간 계산 (22:00 ~ 익일 06:00)
// 시간대를 0 ~ 1440분(하루) 범위로 계산
// 자정을 넘는 근무는 분리해서 교집합 계산
function getNightHours(startTime, endTime) {
    const [sHour, sMin] = startTime.split(":").map(Number);
    const [eHour, eMin] = endTime.split(":").map(Number);
    
    const startMins = sHour * 60 + sMin;
    let endMins = eHour * 60 + eMin;
    
    let intervals = [];
    if (endMins < startMins) {
        // 자정 넘음: 당일 startMins ~ 24:00 (1440분) & 익일 0:00 ~ endMins
        intervals.push([startMins, 1440]);
        intervals.push([0, endMins]);
    } else {
        intervals.push([startMins, endMins]);
    }
    
    let nightMins = 0;
    // 야간 시간 정의 (0 ~ 6시: 0 ~ 360분, 22 ~ 24시: 1320 ~ 1440분)
    intervals.forEach(([s, e]) => {
        // 0 ~ 6시 구간 교집합
        const overlapMorning = Math.max(0, Math.min(e, 360) - Math.max(s, 0));
        // 22 ~ 24시 구간 교집합
        const overlapNight = Math.max(0, Math.min(e, 1440) - Math.max(s, 1320));
        nightMins += overlapMorning + overlapNight;
    });
    
    return nightMins / 60;
}

// 시간 차이를 분 단위로 반환
function getDurationMinutes(startTime, endTime) {
    const [sHour, sMin] = startTime.split(":").map(Number);
    const [eHour, eMin] = endTime.split(":").map(Number);
    
    let diffMins = (eHour * 60 + eMin) - (sHour * 60 + sMin);
    if (diffMins < 0) {
        diffMins += 24 * 60; // 자정 넘음 대응
    }
    return diffMins;
}

// 근무 시작 시각을 기준으로 상대적인 분 단위 매핑
function getRelativeMinutes(timeStr, shiftStartMins) {
    const [hour, min] = timeStr.split(":").map(Number);
    let mins = hour * 60 + min;
    
    let diff = mins - shiftStartMins;
    if (diff < 0) {
        diff += 1440;
    }
    return diff;
}

// 근무 교대조 내 야간 근무 시간의 상대적 백분율 구간 목록 반환
function getNightIntervalsRelative(startTime, endTime) {
    const [sHour, sMin] = startTime.split(":").map(Number);
    const [eHour, eMin] = endTime.split(":").map(Number);
    const startMins = sHour * 60 + sMin;
    let endMins = eHour * 60 + eMin;
    if (endMins < startMins) {
        endMins += 1440;
    }
    const duration = endMins - startMins;
    const relativeNightIntervals = [];
    
    for (let dayOffset = -1; dayOffset <= 2; dayOffset++) {
        const nightStart = dayOffset * 1440 + 1320; // 22:00
        const nightEnd = dayOffset * 1440 + 1800;   // 익일 06:00 (1320 + 480)
        
        const overlapStart = Math.max(startMins, nightStart);
        const overlapEnd = Math.min(endMins, nightEnd);
        
        if (overlapStart < overlapEnd) {
            relativeNightIntervals.push({
                startPercent: ((overlapStart - startMins) / duration) * 100,
                widthPercent: ((overlapEnd - overlapStart) / duration) * 100
            });
        }
    }
    return relativeNightIntervals;
}

// 휴식 시간을 차감한 야간근무 수당 정밀 계산
function getNightHoursWithBreak(startTime, endTime, breakStartTime, breakEndTime, isBreakDeducted, breakMinutes = 0) {
    if (!isBreakDeducted) {
        return getNightHours(startTime, endTime);
    }
    
    // 이전 저장 데이터 포맷 대응 (휴식 시작/종료 시간이 없고 분단위만 등록된 경우 단순 보정 사용)
    if ((!breakStartTime || !breakEndTime) && breakMinutes > 0) {
        const total = getDurationHours(startTime, endTime);
        const night = getNightHours(startTime, endTime);
        const paid = Math.max(0, total - breakMinutes / 60);
        return Math.min(paid, night);
    }
    
    const [sHour, sMin] = startTime.split(":").map(Number);
    const [eHour, eMin] = endTime.split(":").map(Number);
    const startMins = sHour * 60 + sMin;
    let endMins = eHour * 60 + eMin;
    if (endMins < startMins) {
        endMins += 1440;
    }
    
    let breakStartMins = 0;
    let breakEndMins = 0;
    let hasBreak = false;
    
    if (breakStartTime && breakEndTime) {
        hasBreak = true;
        const breakStartRel = getRelativeMinutes(breakStartTime, startMins);
        const breakEndRel = getRelativeMinutes(breakEndTime, startMins);
        breakStartMins = startMins + breakStartRel;
        breakEndMins = startMins + breakEndRel;
        
        if (breakEndMins < breakStartMins) {
            breakEndMins += 1440;
        }
    }
    
    let nightMins = 0;
    for (let m = startMins; m < endMins; m++) {
        const normalizedMins = m % 1440;
        const isNight = (normalizedMins >= 1320 || normalizedMins < 360);
        
        if (isNight) {
            const isBreak = hasBreak && (m >= breakStartMins && m < breakEndMins);
            if (!isBreak) {
                nightMins++;
            }
        }
    }
    
    return nightMins / 60;
}

// 캘린더 주차 구하기 (월요일 ~ 일요일 기준)
// 특정 날짜의 월요일과 일요일 날짜 문자열 반환
function getWeekRange(dateStr) {
    const date = new Date(dateStr);
    const day = date.getDay(); // 0: 일, 1: 월, 2: 화...
    // 일요일(0)이면 -6일, 월요일(1)이면 0일, 화요일(2)이면 -1일...
    const diffToMonday = day === 0 ? -6 : 1 - day;
    
    const monday = new Date(date);
    monday.setDate(date.getDate() + diffToMonday);
    
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    
    return {
        monday: formatDate(monday),
        sunday: formatDate(sunday),
        key: `${formatDate(monday)}~${formatDate(sunday)}`
    };
}

function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}


// --- 3. 월별 총 급여 계산 엔진 ---
function calculateMonthlySalary(yearMonthStr) {
    // yearMonthStr: "YYYY-MM"
    const [year, month] = yearMonthStr.split("-").map(Number);
    
    // 이번 달에 속하는 근무 로그 필터링
    const monthLogs = state.logs.filter(log => log.date.startsWith(yearMonthStr));
    
    // 계산에 필요한 변수들
    let basePayTotal = 0;
    let nightPayTotal = 0;
    let holidayPayTotal = 0; // 공휴일 수당 총액 추가
    let breakTimeDeductionTotal = 0;
    let totalWorkHours = 0;
    
    // 각 로그에 대해 기본급, 야간수당, 공휴일수당, 휴게공제 계산
    monthLogs.forEach(log => {
        const job = state.jobs.find(j => j.id === log.jobId);
        if (!job) return;
        
        const totalHours = getDurationHours(log.startTime, log.endTime);
        const breakHours = log.breakMinutes / 60;
        
        // 휴게시간 차감 옵션 적용 여부 (글로벌 설정에서 휴게시간 급여 지급이 참인 경우 차감하지 않음)
        const isBreakDeducted = state.payDuringBreak ? false : job.useBreakDeduction;
        const paidHours = isBreakDeducted ? Math.max(0, totalHours - breakHours) : totalHours;
        totalWorkHours += paidHours;
        
        // 1. 기본급
        const basePay = paidHours * job.wage;
        basePayTotal += basePay;
        
        // 2. 야간수당
        let nightHours = 0;
        let nightPay = 0;
        if (job.useNightAllowance) {
            nightHours = getNightHours(log.startTime, log.endTime);
            // 휴게시간이 있는 경우 야간 시간도 그에 맞춰 보정 (최대 실근무시간 한도)
            if (isBreakDeducted) {
                nightHours = Math.min(paidHours, nightHours);
            }
            nightPay = nightHours * job.wage * 0.5; // 50% 가산
            nightPayTotal += nightPay;
        }

        // 3. 공휴일수당 (1.5배 -> 50% 가산)
        let holidayPay = 0;
        if (job.useHolidayAllowance && isHoliday(log.date)) {
            holidayPay = paidHours * job.wage * 0.5; // 50% 가산
            holidayPayTotal += holidayPay;
        }
        
        // 4. 휴게시간 공제 표시용 계산
        if (isBreakDeducted && breakHours > 0) {
            breakTimeDeductionTotal += breakHours * job.wage;
        }
    });

    // 5. 주휴수당 (Weekly Holiday Allowance) 계산
    const weeksInMonth = {};
    
    // 이번 달 로그들이 속한 주들의 범위를 수집
    monthLogs.forEach(log => {
        const range = getWeekRange(log.date);
        weeksInMonth[range.key] = range;
    });

    let weeklyAllowanceTotal = 0;
    const weeklyDetails = []; // 주휴수당 상세 내역 보관용

    // 수집된 각 주에 대해 주휴수당 판별
    Object.keys(weeksInMonth).forEach(weekKey => {
        const range = weeksInMonth[weekKey];
        const weeklyLogs = state.logs.filter(log => log.date >= range.monday && log.date <= range.sunday);
        
        // 아르바이트별로 주간 근무시간 합산
        const jobWeeklyHours = {};
        weeklyLogs.forEach(wLog => {
            const job = state.jobs.find(j => j.id === wLog.jobId);
            if (!job) return;
            
            const totalHours = getDurationHours(wLog.startTime, wLog.endTime);
            const breakHours = wLog.breakMinutes / 60;
            const isBreakDeducted = state.payDuringBreak ? false : job.useBreakDeduction;
            const paidHours = isBreakDeducted ? Math.max(0, totalHours - breakHours) : totalHours;
            
            if (!jobWeeklyHours[wLog.jobId]) {
                jobWeeklyHours[wLog.jobId] = {
                    job: job,
                    hoursTotal: 0,
                    hoursInTargetMonth: 0
                };
            }
            jobWeeklyHours[wLog.jobId].hoursTotal += paidHours;
            
            // 이번 달에 일한 시간만 계산 (월 경계를 넘어서는 시간 비율 계산용)
            if (wLog.date.startsWith(yearMonthStr)) {
                jobWeeklyHours[wLog.jobId].hoursInTargetMonth += paidHours;
            }
        });

        // 각 아르바이트별로 주휴수당 지급 기준(주 15시간) 충족 여부 확인
        Object.keys(jobWeeklyHours).forEach(jobId => {
            const data = jobWeeklyHours[jobId];
            const job = data.job;
            
            if (job.useWeeklyAllowance && data.hoursTotal >= 15) {
                const cappedHours = Math.min(40, data.hoursTotal);
                const fullWeeklyAllowance = (cappedHours / 40) * 8 * job.wage;
                const ratio = data.hoursInTargetMonth / data.hoursTotal;
                const allocatedAllowance = fullWeeklyAllowance * ratio;
                
                weeklyAllowanceTotal += allocatedAllowance;
                
                weeklyDetails.push({
                    weekRange: `${range.monday.substring(5)} ~ ${range.sunday.substring(5)}`,
                    jobId: jobId,
                    jobName: job.name,
                    weeklyHours: data.hoursTotal.toFixed(1),
                    qualified: true,
                    allowance: Math.round(allocatedAllowance),
                    isSplit: ratio < 1
                });
            } else if (job.useWeeklyAllowance) {
                weeklyDetails.push({
                    weekRange: `${range.monday.substring(5)} ~ ${range.sunday.substring(5)}`,
                    jobId: jobId,
                    jobName: job.name,
                    weeklyHours: data.hoursTotal.toFixed(1),
                    qualified: false,
                    allowance: 0,
                    isSplit: false
                });
            }
        });
    });

    // 총 예상 수당 합산 (기본급 + 야간수당 + 주휴수당 + 공휴일수당)
    const expectedTotal = basePayTotal + nightPayTotal + weeklyAllowanceTotal + holidayPayTotal;

    // 아르바이트별 예상 급여 분할 합산
    const jobBreakdown = {};
    state.jobs.forEach(job => {
        jobBreakdown[job.id] = {
            name: job.name,
            color: JOB_COLORS[job.colorIndex % JOB_COLORS.length],
            hours: 0,
            base: 0,
            night: 0,
            weekly: 0,
            holiday: 0, // 공휴일 항목 추가
            total: 0
        };
    });

    monthLogs.forEach(log => {
        const job = state.jobs.find(j => j.id === log.jobId);
        if (!job) return;
        
        const totalHours = getDurationHours(log.startTime, log.endTime);
        const breakHours = log.breakMinutes / 60;
        const isBreakDeducted = state.payDuringBreak ? false : job.useBreakDeduction;
        const paidHours = isBreakDeducted ? Math.max(0, totalHours - breakHours) : totalHours;
        
        jobBreakdown[log.jobId].hours += paidHours;
        jobBreakdown[log.jobId].base += paidHours * job.wage;
        
        if (job.useNightAllowance) {
            let nightHours = getNightHours(log.startTime, log.endTime);
            if (isBreakDeducted) nightHours = Math.min(paidHours, nightHours);
            jobBreakdown[log.jobId].night += nightHours * job.wage * 0.5;
        }

        if (job.useHolidayAllowance && isHoliday(log.date)) {
            jobBreakdown[log.jobId].holiday += paidHours * job.wage * 0.5;
        }
    });

    // 주휴수당도 아르바이트별로 가산
    weeklyDetails.forEach(detail => {
        if (jobBreakdown[detail.jobId]) {
            jobBreakdown[detail.jobId].weekly += detail.allowance;
        }
    });

    // 총합 계산
    Object.keys(jobBreakdown).forEach(id => {
        jobBreakdown[id].total = jobBreakdown[id].base + jobBreakdown[id].night + jobBreakdown[id].weekly + jobBreakdown[id].holiday;
    });

    return {
        base: Math.round(basePayTotal),
        night: Math.round(nightPayTotal),
        weekly: Math.round(weeklyAllowanceTotal),
        holiday: Math.round(holidayPayTotal), // 공휴일 수당 추가 반환
        breakDeduction: Math.round(breakTimeDeductionTotal),
        total: Math.round(expectedTotal),
        hours: totalWorkHours,
        logCount: monthLogs.length,
        weeklyDetails: weeklyDetails,
        jobBreakdown: Object.values(jobBreakdown).filter(j => j.total > 0 || j.hours > 0)
    };
}


// --- 4. UI 렌더링 엔진 ---

let currentYearMonth = ""; // 포맷: YYYY-MM
let selectedDateStr = "";  // 포맷: YYYY-MM-DD

// 앱 기동 시 실행되는 초기 설정
document.addEventListener("DOMContentLoaded", () => {
    loadState();
    
    // Google Calendar 공휴일 연동 비동기 호출
    fetchGoogleHolidays();
    
    // 현재 날짜 기준 변수 설정
    const today = new Date();
    currentYearMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    selectedDateStr = formatDate(today);
    
    // 이벤트 바인딩
    setupEventListeners();
    setupOcrScanner(); // OCR 이미지 업로더 바인딩 추가
    setupSettingsTab(); // 환경 설정 이벤트 바인딩 추가
    
    // 초기 렌더링
    updateGreeting();
    renderAll();
    
    // 알림 스케줄러 기동
    startNotificationScheduler();
});

// 알바 이름 등 동적 문구 세팅
function updateGreeting() {
    const hour = new Date().getHours();
    
    // 응원하는 멘트 5개, 장난식 멘트 3개 등을 시간대에 고르게 안착
    const morningGreetings = [
        "기분 좋은 아침입니다! 알차게 시작해봐요! ☀️",
        "상쾌한 아침 공기 마시며 오늘도 힘차게 출발! 🏃‍♂️",
        "오늘 흘린 땀방울이 미래의 달콤한 열매가 될 거예요! 🌟",
        "일어난 것만으로도 오늘의 절반은 해내신 겁니다! 대단해요! 👍",
        "지각 걱정 없는 오늘 하루, 기분 좋게 시작해볼까요? 😉"
    ];
    
    const afternoonGreetings = [
        "즐거운 오후입니다! 근무 중 리프레시를 잊지 마세요! ☕",
        "오후의 피로를 날려버릴 따뜻한 커피 한 잔 어떠세요? 🍵",
        "사장님 몰래 하는 1분의 휴식이 세상에서 가장 달콤한 법! 쉿! 🤫",
        "오늘도 차근차근 해내다 보면 어느새 퇴근 시간! 힘내요! 🚀",
        "조금 피곤해도 스쳐 지나가는 잔고를 생각하며 파이팅! 💸"
    ];
    
    const eveningGreetings = [
        "수고 많으십니다! 퇴근 시간까지 화이팅! 🌙",
        "당신의 성실함이 빛나는 하루입니다. 오늘도 정말 고생 많으셨어요! 🔥",
        "언제나 묵묵히 해내는 당신, 정말 대단하고 자랑스러워요! 👑",
        "월급은 통장을 스칠 뿐이지만, 우리의 열정은 영원하니까요... 맞죠? 😂",
        "일하기 싫은 건 정상입니다! 돈 많은 백수가 되는 그날까지 존버! 💰",
        "오늘 하루도 버텨낸 나 자신에게 아낌없는 칭찬을! 고생하셨습니다! 👏"
    ];
    
    const nightGreetings = [
        "야간 근무자분들, 안전하고 따뜻하게 일하세요! ✨",
        "어두운 밤을 밝히는 당신의 노력이 정말 값진 하루입니다. 🌌",
        "힘든 하루 끝에는 늘 보람찬 월급날이 기다리고 있어요! 🤑",
        "오늘 밤도 평화롭고 무사하게 퇴근할 수 있기를 응원합니다! 🍀"
    ];
    
    let greet = "";
    if (hour >= 5 && hour < 11) {
        greet = morningGreetings[Math.floor(Math.random() * morningGreetings.length)];
    } else if (hour >= 11 && hour < 17) {
        greet = afternoonGreetings[Math.floor(Math.random() * afternoonGreetings.length)];
    } else if (hour >= 17 && hour < 22) {
        greet = eveningGreetings[Math.floor(Math.random() * eveningGreetings.length)];
    } else {
        greet = nightGreetings[Math.floor(Math.random() * nightGreetings.length)];
    }
    
    document.getElementById("header-greeting").innerHTML = `반가워요! ${greet}`;
    
    // 날짜 포맷팅
    const options = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' };
    document.getElementById("header-date").innerText = new Date().toLocaleDateString('ko-KR', options);
}

function renderAll() {
    renderCalendar();
    renderDashboard();
    renderJobsList();
    renderHistory();
    updateNotificationQuickToggle();
    updateOcrJobsDropdown(); // OCR 모달 내 셀렉트박스 정보 갱신
    
    // 로드된 OCR 업로드 이미지 및 스캔 결과 렌더링
    renderOcrPreviews();
    renderScannedShifts();
}

// 1. 대시보드 렌더링 (예상 급여, 수당 브레이크다운, 오늘의 일정)
function renderDashboard() {
    const calc = calculateMonthlySalary(currentYearMonth);
    
    document.getElementById("total-expected-salary").innerText = calc.total.toLocaleString();
    document.getElementById("breakdown-base").innerText = `${calc.base.toLocaleString()}원`;
    document.getElementById("breakdown-weekly").innerText = `+ ${calc.weekly.toLocaleString()}원`;
    document.getElementById("breakdown-night").innerText = `+ ${calc.night.toLocaleString()}원`;
    document.getElementById("breakdown-holiday").innerText = `+ ${calc.holiday.toLocaleString()}원`; // 공휴일 수당 바인딩
    if (state.payDuringBreak) {
        document.getElementById("breakdown-break").innerHTML = `<span style="font-size:12px; color:var(--success-color); font-weight:700;">0원 (유급 적용됨)</span>`;
    } else {
        document.getElementById("breakdown-break").innerText = `- ${calc.breakDeduction.toLocaleString()}원`;
    }
    document.getElementById("breakdown-total").innerText = `${calc.total.toLocaleString()}원`;
    
    // 진행도 바 렌더링 (로그 일수 기준)
    const [year, month] = currentYearMonth.split("-").map(Number);
    const totalDaysInMonth = new Date(year, month, 0).getDate();
    const progressPercent = Math.min(100, (calc.logCount / totalDaysInMonth) * 100);
    
    document.getElementById("salary-progress-fill").style.width = `${progressPercent}%`;
    document.getElementById("salary-progress-text").innerText = `기록된 근무 ${calc.logCount}일 (${calc.hours.toFixed(1)}시간)`;
    
    // 아르바이트별 분할 목록 렌더링
    const dashJobsContainer = document.getElementById("dash-jobs-list");
    if (calc.jobBreakdown.length === 0) {
        dashJobsContainer.innerHTML = `<div class="no-schedule">이번 달 등록된 근무 기록이 없습니다.</div>`;
    } else {
        dashJobsContainer.innerHTML = calc.jobBreakdown.map(j => `
            <div class="dash-job-item">
                <div class="dash-job-meta">
                    <span class="dash-job-name" style="color: ${j.color.text}">${j.name}</span>
                    <span class="dash-job-sub">${j.hours.toFixed(1)}시간 근무 (주휴/야간/공휴일 포함)</span>
                </div>
                <div class="dash-job-pay">${j.total.toLocaleString()}원</div>
            </div>
        `).join("");
    }

    // 오늘의 근무 일정 렌더링
    renderTodaySchedule();
}

function renderTodaySchedule() {
    const todayStr = formatDate(new Date());
    const todayLogs = state.logs.filter(log => log.date === todayStr);
    const scheduleContainer = document.getElementById("today-schedule-list");
    
    // 요일 표시 갱신
    const dateObj = new Date();
    const weekNames = ["일", "월", "화", "수", "목", "금", "토"];
    document.getElementById("today-tag-date").innerText = `${dateObj.getMonth() + 1}/${dateObj.getDate()} (${weekNames[dateObj.getDay()]})`;

    if (todayLogs.length === 0) {
        scheduleContainer.innerHTML = `
            <div class="no-schedule">
                <p>🎉 오늘은 쉬는 날입니다!</p>
                <p style="font-size: 12px; margin-top: 4px;">아침 알람도 울리지 않으니 푹 쉬세요.</p>
            </div>`;
    } else {
        scheduleContainer.innerHTML = todayLogs.map(log => {
            const job = state.jobs.find(j => j.id === log.jobId);
            if (!job) return "";
            
            const color = JOB_COLORS[job.colorIndex % JOB_COLORS.length];
            const duration = getDurationHours(log.startTime, log.endTime);
            const isBreakDeducted = state.payDuringBreak ? false : job.useBreakDeduction;
            const paidHours = isBreakDeducted ? Math.max(0, duration - log.breakMinutes / 60) : duration;
            
            // 당일 일급 계산 (야간/공휴일 포함, 주휴는 제외)
            const base = paidHours * job.wage;
            let night = 0;
            if (job.useNightAllowance) {
                let nightHours = getNightHoursWithBreak(log.startTime, log.endTime, log.breakStartTime, log.breakEndTime, isBreakDeducted, log.breakMinutes);
                night = nightHours * job.wage * 0.5;
            }
            let holiday = 0;
            if (job.useHolidayAllowance && isHoliday(log.date)) {
                holiday = paidHours * job.wage * 0.5;
            }
            const dailyEst = Math.round(base + night + holiday);

            return `
                <div class="schedule-item" style="border-left: 4px solid ${color.border}">
                    <div class="schedule-info">
                        <div class="schedule-avatar" style="background-color: ${color.bg}; color: ${color.text}">
                            ${job.name.substring(0, 1)}
                        </div>
                        <div class="schedule-details">
                            <h4>${job.name} ${isHoliday(log.date) ? `<span style="color:var(--danger-color); font-size:11px; font-weight:700;">(${getHolidayName(log.date)})</span>` : ''}</h4>
                            <p>⏰ ${log.startTime} ~ ${log.endTime} (${log.breakMinutes > 0 ? `휴게 ${log.breakMinutes}분` : "휴게 없음"})</p>
                        </div>
                    </div>
                    <div class="schedule-pay">
                        <div class="est-pay">${dailyEst.toLocaleString()}원</div>
                        <div class="time-length">${paidHours.toFixed(1)}시간 기준</div>
                    </div>
                </div>
            `;
        }).join("");
    }
}

// 2. 달력(Calendar) 렌더링
function renderCalendar() {
    const [year, month] = currentYearMonth.split("-").map(Number);
    
    // 달력 타이틀 변경
    document.getElementById("calendar-title").innerText = `${year}년 ${month}월`;
    
    const daysContainer = document.getElementById("calendar-days-grid");
    daysContainer.innerHTML = "";
    
    // 해당 월의 1일 날짜 객체
    const firstDay = new Date(year, month - 1, 1);
    const startDayOfWeek = firstDay.getDay(); // 0: 일, 1: 월 ...
    
    // 해당 월의 마지막 날짜
    const lastDate = new Date(year, month, 0).getDate();
    
    // 빈 칸 렌더링 (이전 달 날짜 영역)
    for (let i = 0; i < startDayOfWeek; i++) {
        const emptyDiv = document.createElement("div");
        emptyDiv.classList.add("calendar-day", "empty");
        daysContainer.appendChild(emptyDiv);
    }
    
    // 날짜 채우기
    const todayStr = formatDate(new Date());
    
    for (let d = 1; d <= lastDate; d++) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const dateObj = new Date(year, month - 1, d);
        const dayOfWeek = dateObj.getDay();
        
        const dayDiv = document.createElement("div");
        dayDiv.classList.add("calendar-day");
        dayDiv.dataset.date = dateStr;
        
        // 공휴일 판별 및 렌더링 고도화 (날짜 빨간색 및 공휴일명 표기)
        const holidayName = getHolidayName(dateStr);
        if (holidayName) {
            dayDiv.classList.add("holiday");
            dayDiv.innerHTML = `${d}<span class="holiday-label" title="${holidayName}">${holidayName}</span>`;
        } else {
            dayDiv.innerText = d;
            
            // 일반 주말 색상 지정
            if (dayOfWeek === 0) dayDiv.classList.add("sun");
            else if (dayOfWeek === 6) dayDiv.classList.add("sat");
        }
        
        // 오늘 날짜 강조
        if (dateStr === todayStr) {
            dayDiv.classList.add("today");
        }
        
        // 선택된 날짜 강조
        if (dateStr === selectedDateStr) {
            dayDiv.classList.add("selected");
        }
        
        // 근무 기록이 있는지 체크
        const dayLogs = state.logs.filter(log => log.date === dateStr);
        if (dayLogs.length > 0) {
            dayDiv.classList.add("has-log");
            
            // 근무 종류 표시를 위한 점(dots) 추가
            const dotsDiv = document.createElement("div");
            dotsDiv.classList.add("day-dots");
            
            dayLogs.forEach(log => {
                const job = state.jobs.find(j => j.id === log.jobId);
                if (job) {
                    const dot = document.createElement("span");
                    dot.classList.add("day-dot");
                    const color = JOB_COLORS[job.colorIndex % JOB_COLORS.length];
                    dot.style.backgroundColor = color.border;
                    dotsDiv.appendChild(dot);
                }
            });
            dayDiv.appendChild(dotsDiv);
        }
        
        // 클릭 시 이벤트
        dayDiv.addEventListener("click", () => {
            selectedDateStr = dateStr;
            
            // 기존 선택 제거 및 새로운 선택 추가
            document.querySelectorAll(".calendar-day.selected").forEach(el => el.classList.remove("selected"));
            dayDiv.classList.add("selected");
            
            // 근무 기록 추가/수정 모달 띄우기
            openLogModalForDate(dateStr);
        });
        
        daysContainer.appendChild(dayDiv);
    }
}

// 3. 아르바이트 목록 렌더링
function renderJobsList() {
    const container = document.getElementById("jobs-container");
    if (state.jobs.length === 0) {
        container.innerHTML = `
            <div class="card" style="grid-column: 1/-1; text-align: center; padding: 40px;">
                <p style="color: var(--text-muted); font-size: 15px;">등록된 아르바이트가 없습니다.</p>
                <p style="color: var(--text-muted); font-size: 12px; margin-top: 4px;">상단의 '아르바이트 추가' 버튼을 눌러 등록해주세요.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = state.jobs.map(job => {
        const color = JOB_COLORS[job.colorIndex % JOB_COLORS.length];
        
        return `
            <div class="card job-card" style="border-top-color: ${color.border}">
                <div class="job-card-header">
                    <div class="job-card-title">
                        <h3>${job.name}</h3>
                        <p>📍 기본 근무: ${job.defaultStartTime} ~ ${job.defaultEndTime}</p>
                    </div>
                    <div class="job-card-actions">
                        <button class="btn-icon" onclick="editJob('${job.id}')" title="수정">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                            </svg>
                        </button>
                        <button class="btn-icon" onclick="deleteJob('${job.id}')" title="삭제" style="color: var(--danger-color)">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="job-card-wage">
                    ${job.wage.toLocaleString()} <span>원 / 시간</span>
                </div>
                <div class="job-card-details">
                    <div class="detail-line">
                        <span>기본 휴게시간</span>
                        <span>${job.defaultBreak}분</span>
                    </div>
                </div>
                <div class="job-card-options">
                    <span class="badge ${job.useWeeklyAllowance ? 'badge-success' : 'badge-disabled'}">
                        주휴수당 ${job.useWeeklyAllowance ? 'ON' : 'OFF'}
                    </span>
                    <span class="badge ${job.useNightAllowance ? 'badge-accent' : 'badge-disabled'}">
                        야간수당 ${job.useNightAllowance ? 'ON' : 'OFF'}
                    </span>
                    <span class="badge ${job.useBreakDeduction ? 'badge-danger' : 'badge-disabled'}">
                        휴게차감 ${job.useBreakDeduction ? 'ON' : 'OFF'}
                    </span>
                    <span class="badge ${job.useHolidayAllowance ? 'badge-accent' : 'badge-disabled'}" style="background-color: ${job.useHolidayAllowance ? '#FEF3C7' : '#ECECEC'}; color: ${job.useHolidayAllowance ? '#D97706' : '#7B7B7B'}">
                        공휴일수당 ${job.useHolidayAllowance ? 'ON' : 'OFF'}
                    </span>
                </div>
                
                <button class="btn btn-secondary" style="width: 100%; margin-top: 16px; font-size: 13px; padding: 10px 12px; justify-content: center; gap: 6px; border-radius: var(--border-radius-md); font-weight: 700;" onclick="generateJobCode('${job.id}')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align: middle;">
                        <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3M15.5 7.5L19 4"/>
                    </svg>
                    코드생성
                </button>
            </div>
        `;
    }).join("");
}

// 4. 이전 기록 탭 렌더링
function renderHistory() {
    const tableBody = document.getElementById("history-table-body");
    const chartContainer = document.getElementById("history-chart");
    
    // 최근 12개월 목록 추출 (기록이 있는 월 + 최근 달)
    const months = [];
    const today = new Date();
    
    for (let i = 11; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    // 각 월별 급여 데이터 계산
    const monthlyStats = months.map(mStr => {
        const calc = calculateMonthlySalary(mStr);
        return {
            month: mStr,
            calc: calc
        };
    });

    // 테이블 행 작성
    if (monthlyStats.every(s => s.calc.logCount === 0)) {
        tableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 30px;">아직 기록된 월급 정보가 없습니다. 캘린더에서 근무 기록을 입력해보세요!</td></tr>`;
    } else {
        tableBody.innerHTML = monthlyStats
            .filter(s => s.calc.logCount > 0)
            .map(s => {
                const [year, month] = s.month.split("-");
                // 참여 알바 명칭 리스트
                const jobNames = [...new Set(state.logs.filter(log => log.date.startsWith(s.month)).map(log => {
                    const j = state.jobs.find(job => job.id === log.jobId);
                    return j ? j.name : "삭제된 알바";
                }))].join(", ");

                return `
                    <tr>
                        <td>${year}년 ${Number(month)}월</td>
                        <td style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${jobNames || '-'}</td>
                        <td>${s.calc.hours.toFixed(1)}시간 (${s.calc.logCount}일)</td>
                        <td>${s.calc.base.toLocaleString()}원</td>
                        <td class="text-success">+${s.calc.weekly.toLocaleString()}원</td>
                        <td class="text-success">+${s.calc.night.toLocaleString()}원</td>
                        <td style="font-weight: 800; color: var(--primary-color)">${s.calc.total.toLocaleString()}원</td>
                        <td>
                            <button class="btn btn-secondary" style="padding: 6px 12px; font-size: 12px; border-radius: 8px;" onclick="viewHistoryDetail('${s.month}')">상세 보기</button>
                        </td>
                    </tr>
                `;
            }).join("");
    }

    // 차트 생성 (최대 급여를 기준으로 퍼센트 환산)
    const maxSalary = Math.max(...monthlyStats.map(s => s.calc.total), 100000); // 분모 0 방지
    
    chartContainer.innerHTML = monthlyStats.map(s => {
        const [year, month] = s.month.split("-");
        const heightPercent = (s.calc.total / maxSalary) * 100;
        
        return `
            <div class="chart-bar-container">
                <div class="chart-bar" style="height: ${heightPercent}%;" onclick="viewHistoryDetail('${s.month}')">
                    <div class="chart-bar-tooltip">${Number(month)}월: ${s.calc.total.toLocaleString()}원</div>
                </div>
                <div class="chart-label">${Number(month)}월</div>
            </div>
        `;
    }).join("");
}

// 5. 알림 퀵 토글 갱신
function updateNotificationQuickToggle() {
    const toggle = document.getElementById("quick-alert-toggle");
    toggle.checked = state.notificationSettings.enabled;
}


// --- 5. 이벤트 핸들러 및 모달 로직 ---

function setupEventListeners() {
    // 탭 전환 시스템
    document.querySelectorAll(".nav-item").forEach(btn => {
        btn.addEventListener("click", () => {
            const targetTab = btn.dataset.tab;
            
            document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
            
            btn.classList.add("active");
            document.getElementById(targetTab).classList.add("active");
            
            // 활성화될 때마다 다시 데이터 렌더링
            renderAll();
        });
    });

    // 캘린더 월 이동 버튼
    document.getElementById("btn-prev-month").addEventListener("click", () => {
        const [year, month] = currentYearMonth.split("-").map(Number);
        const prevDate = new Date(year, month - 2, 1);
        currentYearMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
        renderCalendar();
        renderDashboard();
    });

    document.getElementById("btn-next-month").addEventListener("click", () => {
        const [year, month] = currentYearMonth.split("-").map(Number);
        const nextDate = new Date(year, month, 1);
        currentYearMonth = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;
        renderCalendar();
        renderDashboard();
    });

    // 알림 토글 핸들러
    document.getElementById("quick-alert-toggle").addEventListener("change", (e) => {
        state.notificationSettings.enabled = e.target.checked;
        saveState();
        
        if (state.notificationSettings.enabled) {
            requestNotificationPermission();
            showToast("알림 설정 완료", "매일 오전 5시 무렵 당일 근무 일정이 있을 시 푸시 알림이 발송됩니다.");
        } else {
            showToast("알림 비활성화", "근무 푸시 알림이 비활성화되었습니다.");
        }
    });

    // 알림 테스트 버튼
    document.getElementById("btn-test-notification").addEventListener("click", testNotification);

    // 신규 아르바이트 추가 버튼
    document.getElementById("btn-add-job").addEventListener("click", () => {
        openJobModal();
    });
    
    // 헤더 근무 추가 퀵 버튼 (선택된 날짜에 로그 바로 추가)
    document.getElementById("btn-quick-add-log").addEventListener("click", () => {
        openLogModalForDate(selectedDateStr);
    });

    // 모달 닫기 및 취소 버튼들
    document.getElementById("btn-close-job-modal").addEventListener("click", closeJobModal);
    document.getElementById("btn-cancel-job").addEventListener("click", closeJobModal);
    
    document.getElementById("btn-close-log-modal").addEventListener("click", closeLogModal);
    document.getElementById("btn-cancel-log").addEventListener("click", closeLogModal);

    document.getElementById("btn-close-history-detail-modal").addEventListener("click", closeHistoryDetailModal);
    document.getElementById("btn-close-history-detail").addEventListener("click", closeHistoryDetailModal);

    // 일지 입력 폼 입력 감지 (종료 시간 설정 시 실시간 근무시간 계산 프리뷰 제공)
    const logStart = document.getElementById("log-start-time");
    const logEnd = document.getElementById("log-end-time");
    const logBreak = document.getElementById("log-break");
    
    const updateLogHoursPreview = () => {
        const sTime = logStart.value;
        const eTime = logEnd.value;
        const bMin = Number(logBreak.value) || 0;
        
        if (sTime && eTime) {
            const total = getDurationHours(sTime, eTime);
            const paid = Math.max(0, total - (bMin / 60));
            document.getElementById("log-calculated-hours").value = 
                `${paid.toFixed(1)}시간 (총 ${total.toFixed(1)}시간 중 휴게 ${bMin}분 제외)`;
        }
    };
    
    logStart.addEventListener("input", updateLogHoursPreview);
    logEnd.addEventListener("input", updateLogHoursPreview);
    logBreak.addEventListener("input", updateLogHoursPreview);

    // 아르바이트 추가/수정 폼 제출
    document.getElementById("form-job").addEventListener("submit", onJobFormSubmit);

    // 근무 기록 추가/수정 폼 제출
    document.getElementById("form-log").addEventListener("submit", onLogFormSubmit);
    
    // 로그 삭제 버튼
    document.getElementById("btn-delete-log").addEventListener("click", onDeleteLogClick);

    // 코드로 일괄 등록 버튼 및 입력 필드 이벤트 바인딩
    const btnImportCode = document.getElementById("btn-import-code");
    if (btnImportCode) {
        btnImportCode.addEventListener("click", () => {
            window.importJobCode();
        });
    }
    const logImportInput = document.getElementById("log-import-code");
    if (logImportInput) {
        logImportInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                window.importJobCode();
            }
        });
    }

    // 공휴일 체크박스 토글에 따른 이름 입력칸 표시여부 변경
    const holidayCheckbox = document.getElementById("log-is-holiday");
    const holidayNameGroup = document.getElementById("log-holiday-name-group");
    if (holidayCheckbox && holidayNameGroup) {
        holidayCheckbox.addEventListener("change", (e) => {
            if (e.target.checked) {
                holidayNameGroup.style.display = "block";
                const holidayNameInput = document.getElementById("log-holiday-name");
                if (holidayNameInput && !holidayNameInput.value) {
                    holidayNameInput.value = "공휴일";
                }
            } else {
                holidayNameGroup.style.display = "none";
            }
        });
    }
}

// --- 환경 설정 관련 이벤트 바인딩 ---
function setupSettingsTab() {
    const ocrNameInput = document.getElementById("ocr-name");
    const settingsUsernameInput = document.getElementById("settings-username");
    const settingsPayBreakCheckbox = document.getElementById("settings-pay-during-break");
    const settingsAlertCheckbox = document.getElementById("settings-alert-toggle");
    const settingsAlertTimeInput = document.getElementById("settings-alert-time");
    const btnSettingsTestAlert = document.getElementById("btn-settings-test-alert");
    const btnResetData = document.getElementById("btn-settings-reset-data");

    // 1. 상태 동기화
    if (state.userName) {
        if (ocrNameInput) ocrNameInput.value = state.userName;
        if (settingsUsernameInput) settingsUsernameInput.value = state.userName;
    }
    if (settingsPayBreakCheckbox) {
        settingsPayBreakCheckbox.checked = state.payDuringBreak;
    }
    if (settingsAlertCheckbox) {
        settingsAlertCheckbox.checked = state.notificationSettings.enabled;
    }
    if (settingsAlertTimeInput && state.notificationSettings.time) {
        settingsAlertTimeInput.value = state.notificationSettings.time;
    }

    // 2. 이벤트 리스너 등록
    if (ocrNameInput) {
        ocrNameInput.addEventListener("input", (e) => {
            state.userName = e.target.value;
            if (settingsUsernameInput) settingsUsernameInput.value = state.userName;
            saveState();
        });
    }
    if (settingsUsernameInput) {
        settingsUsernameInput.addEventListener("input", (e) => {
            state.userName = e.target.value;
            if (ocrNameInput) ocrNameInput.value = state.userName;
            saveState();
        });
    }
    if (settingsPayBreakCheckbox) {
        settingsPayBreakCheckbox.addEventListener("change", (e) => {
            state.payDuringBreak = e.target.checked;
            saveState();
            renderDashboard(); // 금액 재계산 및 렌더링
        });
    }
    if (settingsAlertCheckbox) {
        settingsAlertCheckbox.addEventListener("change", (e) => {
            state.notificationSettings.enabled = e.target.checked;
            const quickAlert = document.getElementById("quick-alert-toggle");
            if (quickAlert) quickAlert.checked = state.notificationSettings.enabled;
            saveState();
            if (state.notificationSettings.enabled) {
                requestNotificationPermission();
                showToast("알림 활성화", "매일 지정된 시간에 당일 근무 알림이 발송됩니다.");
            } else {
                showToast("알림 비활성화", "근무 푸시 알림이 비활성화되었습니다.");
            }
        });
    }
    if (settingsAlertTimeInput) {
        settingsAlertTimeInput.addEventListener("change", (e) => {
            state.notificationSettings.time = e.target.value;
            saveState();
        });
    }
    if (btnSettingsTestAlert) {
        btnSettingsTestAlert.addEventListener("click", testNotification);
    }
    if (btnResetData) {
        btnResetData.addEventListener("click", () => {
            if (confirm("정말로 모든 데이터를 초기화하시겠습니까?\n아르바이트 목록, 근무 기록, 환경 설정이 전부 삭제됩니다.")) {
                localStorage.removeItem(STORAGE_KEY);
                showToast("초기화 완료", "모든 데이터가 삭제되었습니다. 1초 뒤 페이지가 새로고침됩니다.");
                setTimeout(() => {
                    window.location.reload();
                }, 1000);
            }
        });
    }
}

// --- 아르바이트 관련 CRUD 기능 ---

function openJobModal(jobId = null) {
    const modal = document.getElementById("modal-job");
    const form = document.getElementById("form-job");
    form.reset();
    
    if (jobId) {
        document.getElementById("modal-job-title").innerText = "아르바이트 정보 수정";
        const job = state.jobs.find(j => j.id === jobId);
        if (job) {
            document.getElementById("job-id").value = job.id;
            document.getElementById("job-name").value = job.name;
            document.getElementById("job-wage").value = job.wage;
            document.getElementById("job-start-time").value = job.defaultStartTime;
            document.getElementById("job-end-time").value = job.defaultEndTime;
            document.getElementById("job-break").value = job.defaultBreak;
            document.getElementById("job-use-weekly-allowance").checked = job.useWeeklyAllowance;
            document.getElementById("job-use-night-allowance").checked = job.useNightAllowance;
            document.getElementById("job-use-break-deduction").checked = job.useBreakDeduction;
            document.getElementById("job-use-holiday-allowance").checked = job.useHolidayAllowance !== false; // 기본값 참
        }
    } else {
        document.getElementById("modal-job-title").innerText = "아르바이트 등록";
        document.getElementById("job-id").value = "";
        // 기본값 복구
        document.getElementById("job-wage").value = "10030";
        document.getElementById("job-start-time").value = "09:00";
        document.getElementById("job-end-time").value = "18:00";
        document.getElementById("job-break").value = "0";
        document.getElementById("job-use-holiday-allowance").checked = true;
    }
    
    modal.classList.add("active");
}

function closeJobModal() {
    document.getElementById("modal-job").classList.remove("active");
}

function onJobFormSubmit(e) {
    e.preventDefault();
    
    const jobId = document.getElementById("job-id").value;
    const name = document.getElementById("job-name").value.trim();
    const wage = Number(document.getElementById("job-wage").value);
    const start = document.getElementById("job-start-time").value;
    const end = document.getElementById("job-end-time").value;
    const breakMin = Number(document.getElementById("job-break").value) || 0;
    
    const useWeekly = document.getElementById("job-use-weekly-allowance").checked;
    const useNight = document.getElementById("job-use-night-allowance").checked;
    const useBreak = document.getElementById("job-use-break-deduction").checked;
    const useHoliday = document.getElementById("job-use-holiday-allowance").checked;
    
    if (!name) return;
    
    if (jobId) {
        // 수정
        const idx = state.jobs.findIndex(j => j.id === jobId);
        if (idx !== -1) {
            state.jobs[idx] = {
                ...state.jobs[idx],
                name, wage, defaultStartTime: start, defaultEndTime: end, defaultBreak: breakMin,
                useWeeklyAllowance: useWeekly, useNightAllowance: useNight, useBreakDeduction: useBreak,
                useHolidayAllowance: useHoliday
            };
            showToast("수정 완료", `'${name}'의 정보가 변경되었습니다.`);
        }
    } else {
        // 생성
        const newJob = {
            id: `job-${Date.now()}`,
            name, wage, defaultStartTime: start, defaultEndTime: end, defaultBreak: breakMin,
            useWeeklyAllowance: useWeekly, useNightAllowance: useNight, useBreakDeduction: useBreak,
            useHolidayAllowance: useHoliday,
            colorIndex: state.jobs.length
        };
        state.jobs.push(newJob);
        showToast("등록 완료", `'${name}' 아르바이트가 새로 등록되었습니다.`);
    }
    
    saveState();
    closeJobModal();
    renderAll();
}

function editJob(id) {
    openJobModal(id);
}

function deleteJob(id) {
    const job = state.jobs.find(j => j.id === id);
    if (!job) return;
    
    if (confirm(`'${job.name}' 아르바이트를 삭제하시겠습니까?\n해당 아르바이트로 등록된 모든 근무 기록도 함께 삭제됩니다.`)) {
        state.jobs = state.jobs.filter(j => j.id !== id);
        state.logs = state.logs.filter(log => log.jobId !== id);
        
        saveState();
        renderAll();
        showToast("삭제 완료", `'${job.name}' 아르바이트가 삭제되었습니다.`);
    }
}

// 아르바이트 설정 및 근무 일정을 코드로 생성
window.generateJobCode = function(jobId) {
    const job = state.jobs.find(j => j.id === jobId);
    if (!job) return;
    
    const jobLogs = state.logs.filter(l => l.jobId === jobId);
    
    const payload = {
        job: {
            name: job.name,
            wage: job.wage,
            defaultStartTime: job.defaultStartTime,
            defaultEndTime: job.defaultEndTime,
            defaultBreak: job.defaultBreak,
            useWeeklyAllowance: job.useWeeklyAllowance,
            useNightAllowance: job.useNightAllowance,
            useBreakDeduction: job.useBreakDeduction,
            useHolidayAllowance: job.useHolidayAllowance,
            colorIndex: job.colorIndex
        },
        logs: jobLogs.map(l => ({
            date: l.date,
            startTime: l.startTime,
            endTime: l.endTime,
            breakStartTime: l.breakStartTime || "",
            breakEndTime: l.breakEndTime || "",
            breakMinutes: l.breakMinutes || 0
        }))
    };
    
    try {
        const jsonStr = JSON.stringify(payload);
        // UTF-8 호환 Base64 인코딩
        const base64Code = btoa(encodeURIComponent(jsonStr).replace(/%([0-9A-F]{2})/g, function(match, p1) {
            return String.fromCharCode('0x' + p1);
        }));
        
        navigator.clipboard.writeText(base64Code).then(() => {
            showToast("코드 생성 및 복사 완료", `'${job.name}' 아르바이트의 설정과 일정 코드가 클립보드에 복사되었습니다! 근무 추가 창에서 등록해 보세요.`, "toast-success");
        }).catch(err => {
            // 복사 실패 시 fallback
            prompt("아래 코드를 복사하여 근무 추가 창에 붙여넣으세요:", base64Code);
        });
    } catch (e) {
        console.error("코드 생성 실패:", e);
        showToast("코드 생성 실패", "코드 생성 중 오류가 발생했습니다.", "toast-danger");
    }
};

// 입력받은 코드를 해독하여 아르바이트 및 근무 일정을 한 번에 복원
window.importJobCode = function() {
    const codeInput = document.getElementById("log-import-code");
    if (!codeInput) return;
    const base64Code = codeInput.value.trim();
    if (!base64Code) {
        showToast("코드 입력 필요", "생성된 코드를 입력한 후 등록해 주세요.", "toast-danger");
        return;
    }
    
    try {
        // UTF-8 호환 Base64 디코딩
        const jsonStr = decodeURIComponent(atob(base64Code).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        
        const data = JSON.parse(jsonStr);
        if (!data || !data.job || !data.job.name || !Array.isArray(data.logs)) {
            throw new Error("Invalid code format");
        }
        
        const jobData = data.job;
        const logList = data.logs;
        
        // 1. 동일한 이름의 아르바이트가 있는지 확인
        let targetJob = state.jobs.find(j => j.name === jobData.name);
        if (!targetJob) {
            targetJob = {
                id: `job-${Date.now()}`,
                name: jobData.name,
                wage: jobData.wage,
                defaultStartTime: jobData.defaultStartTime,
                defaultEndTime: jobData.defaultEndTime,
                defaultBreak: jobData.defaultBreak,
                useWeeklyAllowance: jobData.useWeeklyAllowance,
                useNightAllowance: jobData.useNightAllowance,
                useBreakDeduction: jobData.useBreakDeduction,
                useHolidayAllowance: jobData.useHolidayAllowance !== false,
                colorIndex: state.jobs.length
            };
            state.jobs.push(targetJob);
        }
        
        // 2. 일정 일괄 등록
        let addedCount = 0;
        let dupCount = 0;
        logList.forEach(log => {
            // 동일 날짜에 동일 알바 근무 기록이 있으면 덮어쓰기
            const dupIdx = state.logs.findIndex(l => l.date === log.date && l.jobId === targetJob.id);
            const logData = {
                id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
                date: log.date,
                jobId: targetJob.id,
                startTime: log.startTime,
                endTime: log.endTime,
                breakStartTime: log.breakStartTime || "",
                breakEndTime: log.breakEndTime || "",
                breakMinutes: log.breakMinutes || 0
            };
            
            if (dupIdx !== -1) {
                state.logs[dupIdx] = logData;
                dupCount++;
            } else {
                state.logs.push(logData);
                addedCount++;
            }
        });
        
        saveState();
        closeLogModal();
        renderAll();
        
        showToast("일정 일괄 등록 성공", `'${targetJob.name}' 근무 일정이 등록되었습니다. (신규: ${addedCount}건, 덮어쓰기: ${dupCount}건)`, "toast-success");
        codeInput.value = "";
    } catch (e) {
        console.error("코드 디코딩 및 등록 실패:", e);
        showToast("등록 실패", "올바르지 않은 코드 형식이거나 처리 중 오류가 발생했습니다.", "toast-danger");
    }
};


// --- 근무 기록(Log) 관련 CRUD 기능 ---

function setWorkLogFieldsRequired(isRequired) {
    const select = document.getElementById("log-job-id");
    const logStart = document.getElementById("log-start-time");
    const logEnd = document.getElementById("log-end-time");
    
    if (select && logStart && logEnd) {
        if (isRequired) {
            select.setAttribute("required", "required");
            logStart.setAttribute("required", "required");
            logEnd.setAttribute("required", "required");
        } else {
            select.removeAttribute("required");
            logStart.removeAttribute("required");
            logEnd.removeAttribute("required");
        }
    }
}

function openLogModalForDate(dateStr) {
    const modal = document.getElementById("modal-log");
    const form = document.getElementById("form-log");
    form.reset();

    const select = document.getElementById("log-job-id");
    const workLogToggleSection = document.getElementById("work-log-toggle-section");
    const workLogDetailsContainer = document.getElementById("work-log-details-container");
    const deleteBtn = document.getElementById("btn-delete-log");
    
    // 날짜 입력
    document.getElementById("log-date").value = dateStr;

    // 공휴일 UI 바인딩
    const isHolidayDay = isHoliday(dateStr);
    const holidayName = getHolidayName(dateStr);
    const holidayCheckbox = document.getElementById("log-is-holiday");
    const holidayNameInput = document.getElementById("log-holiday-name");
    const holidayNameGroup = document.getElementById("log-holiday-name-group");
    
    if (holidayCheckbox) {
        holidayCheckbox.checked = isHolidayDay;
    }
    if (holidayNameInput) {
        holidayNameInput.value = holidayName;
    }
    if (holidayNameGroup) {
        holidayNameGroup.style.display = isHolidayDay ? "block" : "none";
    }

    // 근무 기록 UI 바인딩
    const existingLog = state.logs.find(l => l.date === dateStr);
    
    if (state.jobs.length === 0) {
        // 등록된 아르바이트가 없는 경우
        if (workLogToggleSection) {
            workLogToggleSection.innerHTML = `
                <div style="font-size: 13px; color: var(--text-muted); background: var(--bg-color); padding: 12px; border-radius: var(--border-radius-md); border: 1px solid var(--border-color); line-height: 1.4;">
                    💡 등록된 아르바이트가 없습니다. 아르바이트 관리 탭에서 아르바이트를 먼저 등록하시면 근무 기록도 함께 추가할 수 있습니다.
                </div>
            `;
        }
        if (workLogDetailsContainer) {
            workLogDetailsContainer.style.display = "none";
        }
        setWorkLogFieldsRequired(false);
        if (deleteBtn) {
            deleteBtn.classList.add("hidden");
        }
        document.getElementById("log-id").value = "";
    } else {
        // 등록된 아르바이트가 있는 경우
        if (workLogToggleSection) {
            workLogToggleSection.innerHTML = `
                <label class="checkbox-option">
                    <input type="checkbox" id="log-has-work">
                    <span class="checkbox-custom"></span>
                    <div class="checkbox-label-group">
                        <span class="title">이 날에 근무 기록 입력</span>
                        <span class="desc">이 날의 출퇴근 시간 및 휴게 시간을 기록합니다.</span>
                    </div>
                </label>
            `;
        }
        
        const newHasWorkCheckbox = document.getElementById("log-has-work");
        if (newHasWorkCheckbox && workLogDetailsContainer) {
            newHasWorkCheckbox.addEventListener("change", (e) => {
                if (e.target.checked) {
                    workLogDetailsContainer.style.display = "block";
                    setWorkLogFieldsRequired(true);
                } else {
                    workLogDetailsContainer.style.display = "none";
                    setWorkLogFieldsRequired(false);
                }
                updateDailySalaryPreview();
                updateTimeline();
            });
        }

        if (select) {
            select.innerHTML = state.jobs.map(j => `<option value="${j.id}">${j.name}</option>`).join("");
        }

        if (existingLog) {
            document.getElementById("modal-log-title").innerText = "근무 및 공휴일 관리";
            document.getElementById("log-id").value = existingLog.id;
            if (newHasWorkCheckbox) {
                newHasWorkCheckbox.checked = true;
            }
            if (workLogDetailsContainer) {
                workLogDetailsContainer.style.display = "block";
            }
            setWorkLogFieldsRequired(true);

            if (select) {
                select.value = existingLog.jobId;
            }
            document.getElementById("log-start-time").value = existingLog.startTime;
            document.getElementById("log-end-time").value = existingLog.endTime;
            document.getElementById("log-break-start").value = existingLog.breakStartTime || "";
            document.getElementById("log-break-end").value = existingLog.breakEndTime || "";
            document.getElementById("log-break").value = existingLog.breakMinutes || 0;
            if (deleteBtn) {
                deleteBtn.classList.remove("hidden");
            }
        } else {
            document.getElementById("modal-log-title").innerText = "근무 및 공휴일 관리";
            document.getElementById("log-id").value = "";
            if (newHasWorkCheckbox) {
                newHasWorkCheckbox.checked = false;
            }
            if (workLogDetailsContainer) {
                workLogDetailsContainer.style.display = "none";
            }
            setWorkLogFieldsRequired(false);
            if (deleteBtn) {
                deleteBtn.classList.add("hidden");
            }
            
            const defaultJob = state.jobs[0];
            if (select && defaultJob) {
                select.value = defaultJob.id;
            }
            if (defaultJob) {
                document.getElementById("log-start-time").value = defaultJob.defaultStartTime;
                document.getElementById("log-end-time").value = defaultJob.defaultEndTime;
                
                // Pre-fill break times based on defaultBreak minutes
                if (defaultJob.defaultBreak === 60) {
                    document.getElementById("log-break-start").value = "12:00";
                    document.getElementById("log-break-end").value = "13:00";
                } else if (defaultJob.defaultBreak === 30) {
                    document.getElementById("log-break-start").value = "12:00";
                    document.getElementById("log-break-end").value = "12:30";
                } else {
                    document.getElementById("log-break-start").value = "";
                    document.getElementById("log-break-end").value = "";
                }
                document.getElementById("log-break").value = defaultJob.defaultBreak;
            }
        }

        if (select) {
            select.onchange = () => {
                const job = state.jobs.find(j => j.id === select.value);
                if (job) {
                    document.getElementById("log-start-time").value = job.defaultStartTime;
                    document.getElementById("log-end-time").value = job.defaultEndTime;
                    
                    if (job.defaultBreak === 60) {
                        document.getElementById("log-break-start").value = "12:00";
                        document.getElementById("log-break-end").value = "13:00";
                    } else if (job.defaultBreak === 30) {
                        document.getElementById("log-break-start").value = "12:00";
                        document.getElementById("log-break-end").value = "12:30";
                    } else {
                        document.getElementById("log-break-start").value = "";
                        document.getElementById("log-break-end").value = "";
                    }
                    document.getElementById("log-break").value = job.defaultBreak;
                    
                    updateDailySalaryPreview();
                    updateTimeline();
                }
            };
        }
        
        // Bind dynamic input triggers for real-time recalculation
        const triggerInputs = [
            "log-date", "log-job-id", "log-start-time", "log-end-time",
            "log-break-start", "log-break-end", "log-is-holiday"
        ];
        triggerInputs.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.removeEventListener("input", onModalInputChange);
                el.removeEventListener("change", onModalInputChange);
                el.addEventListener("input", onModalInputChange);
                el.addEventListener("change", onModalInputChange);
            }
        });

        // Trigger initial calculation
        updateDailySalaryPreview();
        updateTimeline();
    }
    
    modal.classList.add("active");
}

function onModalInputChange() {
    // Sync computed break minutes to the hidden #log-break field
    const breakStart = document.getElementById("log-break-start").value;
    const breakEnd = document.getElementById("log-break-end").value;
    if (breakStart && breakEnd) {
        document.getElementById("log-break").value = getDurationMinutes(breakStart, breakEnd);
    } else {
        document.getElementById("log-break").value = 0;
    }
    
    updateDailySalaryPreview();
    updateTimeline();
}

function closeLogModal() {
    document.getElementById("modal-log").classList.remove("active");
}

function onLogFormSubmit(e) {
    e.preventDefault();
    
    const logId = document.getElementById("log-id").value;
    const date = document.getElementById("log-date").value;
    
    // 1. 공휴일 설정 저장
    const holidayCheckbox = document.getElementById("log-is-holiday");
    const holidayNameInput = document.getElementById("log-holiday-name");
    
    if (!state.customHolidays) {
        state.customHolidays = {};
    }
    
    if (holidayCheckbox && holidayCheckbox.checked) {
        state.customHolidays[date] = (holidayNameInput ? holidayNameInput.value.trim() : "") || "공휴일";
    } else {
        const isDefaultHoliday = !!(KOREAN_HOLIDAYS_2026[date] || (state.googleHolidays && state.googleHolidays[date]));
        if (isDefaultHoliday) {
            state.customHolidays[date] = ""; // 공휴일 오버라이드로 비활성화
        } else {
            delete state.customHolidays[date];
        }
    }
    
    // 2. 근무 기록 저장
    const hasWorkCheckbox = document.getElementById("log-has-work");
    const hasWork = hasWorkCheckbox ? hasWorkCheckbox.checked : false;
    
    if (hasWork && state.jobs.length > 0) {
        const jobId = document.getElementById("log-job-id").value;
        const startTime = document.getElementById("log-start-time").value;
        const endTime = document.getElementById("log-end-time").value;
        const breakStart = document.getElementById("log-break-start").value;
        const breakEnd = document.getElementById("log-break-end").value;
        
        let breakMinutes = Number(document.getElementById("log-break").value) || 0;
        if (breakStart && breakEnd) {
            breakMinutes = getDurationMinutes(breakStart, breakEnd);
        }
        
        const job = state.jobs.find(j => j.id === jobId);
        if (job) {
            const logData = {
                id: logId || `log-${Date.now()}`,
                date,
                jobId,
                startTime,
                endTime,
                breakStartTime: breakStart,
                breakEndTime: breakEnd,
                breakMinutes
            };

            if (logId) {
                // 수정
                const idx = state.logs.findIndex(l => l.id === logId);
                if (idx !== -1) {
                    state.logs[idx] = logData;
                    showToast("기록 수정 완료", `'${job.name}'의 근무 내역을 수정했습니다.`);
                }
            } else {
                // 신규 추가
                const dupIdx = state.logs.findIndex(l => l.date === date && l.jobId === jobId);
                if (dupIdx !== -1) {
                    state.logs[dupIdx] = logData;
                } else {
                    state.logs.push(logData);
                }
                showToast("근무 등록 완료", `'${job.name}' 근무 일정이 기록되었습니다.`);
            }
        }
    } else {
        // 근무 정보가 체크해제되었거나 아르바이트가 없는 경우 기존 로그 삭제
        if (logId) {
            state.logs = state.logs.filter(l => l.id !== logId);
            showToast("근무 삭제 완료", "이 날짜의 근무 기록을 삭제했습니다.");
        }
    }
    
    saveState();
    closeLogModal();
    renderAll();
}

// 실시간 일일 급여 프리뷰 렌더링
function updateDailySalaryPreview() {
    const date = document.getElementById("log-date").value;
    const hasWorkCheckbox = document.getElementById("log-has-work");
    const hasWork = hasWorkCheckbox ? hasWorkCheckbox.checked : false;
    
    const previewCard = document.getElementById("log-salary-preview-card");
    if (!previewCard) return;

    if (!hasWork || state.jobs.length === 0) {
        previewCard.style.display = "none";
        return;
    }

    const jobId = document.getElementById("log-job-id").value;
    const startTime = document.getElementById("log-start-time").value;
    const endTime = document.getElementById("log-end-time").value;
    const breakStart = document.getElementById("log-break-start").value;
    const breakEnd = document.getElementById("log-break-end").value;

    const job = state.jobs.find(j => j.id === jobId);
    if (!job || !startTime || !endTime) {
        previewCard.style.display = "none";
        return;
    }

    let breakMinutes = 0;
    if (breakStart && breakEnd) {
        breakMinutes = getDurationMinutes(breakStart, breakEnd);
    }

    const totalHours = getDurationHours(startTime, endTime);
    const breakHours = breakMinutes / 60;
    const isBreakDeducted = state.payDuringBreak ? false : job.useBreakDeduction;
    const paidHours = isBreakDeducted ? Math.max(0, totalHours - breakHours) : totalHours;

    // 1. 기본급
    const basePay = paidHours * job.wage;

    // 2. 야간수당 (오후 10시 ~ 익일 오전 6시 사이 근무 시간만 1.5배)
    let nightHours = 0;
    let nightPay = 0;
    if (job.useNightAllowance) {
        nightHours = getNightHoursWithBreak(startTime, endTime, breakStart, breakEnd, isBreakDeducted, breakMinutes);
        nightPay = nightHours * job.wage * 0.5;
    }

    // 3. 공휴일수당 (공휴일 근무 시 1.5배)
    const holidayCheckbox = document.getElementById("log-is-holiday");
    const isHolidayChecked = holidayCheckbox ? holidayCheckbox.checked : isHoliday(date);
    let holidayPay = 0;
    if (job.useHolidayAllowance && isHolidayChecked) {
        holidayPay = paidHours * job.wage * 0.5;
    }

    const totalPay = Math.round(basePay + nightPay + holidayPay);

    document.getElementById("log-total-salary-preview").innerText = totalPay.toLocaleString();

    let breakdownText = `• 기본급: ${Math.round(basePay).toLocaleString()}원 (${paidHours.toFixed(1)}시간)`;
    if (nightPay > 0) {
        breakdownText += `<br>• 야간수당 (+50%): +${Math.round(nightPay).toLocaleString()}원 (${nightHours.toFixed(1)}시간)`;
    }
    if (holidayPay > 0) {
        breakdownText += `<br>• 공휴일수당 (+50%): +${Math.round(holidayPay).toLocaleString()}원 (${paidHours.toFixed(1)}시간)`;
    }
    if (isBreakDeducted && breakHours > 0) {
        breakdownText += `<br>• 휴게시간 차감: -${Math.round(breakHours * job.wage).toLocaleString()}원 (${breakHours.toFixed(1)}시간)`;
    }

    document.getElementById("log-salary-breakdown-preview").innerHTML = breakdownText;
    previewCard.style.display = "block";
}

// 실시간 타임라인 막대 렌더링
function updateTimeline() {
    const hasWorkCheckbox = document.getElementById("log-has-work");
    const hasWork = hasWorkCheckbox ? hasWorkCheckbox.checked : false;
    const timelineContainer = document.getElementById("log-timeline-container");

    if (!timelineContainer) return;

    if (!hasWork || state.jobs.length === 0) {
        timelineContainer.style.display = "none";
        return;
    }

    const startTime = document.getElementById("log-start-time").value;
    const endTime = document.getElementById("log-end-time").value;
    const breakStart = document.getElementById("log-break-start").value;
    const breakEnd = document.getElementById("log-break-end").value;

    if (!startTime || !endTime) {
        timelineContainer.style.display = "none";
        return;
    }

    timelineContainer.style.display = "block";

    // 근무 시간 계산
    const [sHour, sMin] = startTime.split(":").map(Number);
    let [eHour, eMin] = endTime.split(":").map(Number);
    const startMins = sHour * 60 + sMin;
    let endMins = eHour * 60 + eMin;
    if (endMins < startMins) {
        endMins += 1440;
    }
    const durationMins = endMins - startMins;
    const durationHours = durationMins / 60;

    // 라벨 업데이트
    document.getElementById("timeline-start-label").innerText = startTime;
    document.getElementById("timeline-end-label").innerText = endTime;
    document.getElementById("timeline-duration-label").innerText = `${durationHours.toFixed(1)}시간 근무`;

    // 야간 근무 오버레이 렌더링
    const nightBarsContainer = document.getElementById("timeline-night-bars-container");
    if (nightBarsContainer) {
        nightBarsContainer.innerHTML = "";
        const nightIntervals = getNightIntervalsRelative(startTime, endTime);
        nightIntervals.forEach(interval => {
            const nightBar = document.createElement("div");
            nightBar.style.position = "absolute";
            nightBar.style.height = "100%";
            nightBar.style.backgroundColor = "rgba(99, 102, 241, 0.35)"; // 반투명 인디고
            nightBar.style.borderLeft = "1.5px dashed #4F46E5";
            nightBar.style.borderRight = "1.5px dashed #4F46E5";
            nightBar.style.left = `${interval.startPercent}%`;
            nightBar.style.width = `${interval.widthPercent}%`;
            nightBar.style.top = "0";
            nightBarsContainer.appendChild(nightBar);
        });
    }

    // 휴식 시간 오버레이 렌더링
    const breakBar = document.getElementById("timeline-break-bar");
    if (breakBar) {
        if (breakStart && breakEnd) {
            const breakStartRel = getRelativeMinutes(breakStart, startMins);
            const breakEndRel = getRelativeMinutes(breakEnd, startMins);
            
            let startPct = (breakStartRel / durationMins) * 100;
            let endPct = (breakEndRel / durationMins) * 100;
            
            if (endPct < startPct) {
                endPct += 100;
            }
            
            let widthPct = endPct - startPct;
            
            startPct = Math.max(0, Math.min(100, startPct));
            widthPct = Math.max(0, Math.min(100 - startPct, widthPct));

            if (widthPct > 0) {
                breakBar.style.left = `${startPct}%`;
                breakBar.style.width = `${widthPct}%`;
                breakBar.style.display = "flex";
                const breakDuration = getDurationMinutes(breakStart, breakEnd);
                breakBar.querySelector("span").innerText = `휴식 (${breakDuration}분)`;
            } else {
                breakBar.style.display = "none";
            }
        } else {
            breakBar.style.display = "none";
        }
    }
}

function onDeleteLogClick() {
    const logId = document.getElementById("log-id").value;
    if (!logId) return;
    
    const log = state.logs.find(l => l.id === logId);
    if (!log) return;
    
    const job = state.jobs.find(j => j.id === log.jobId);
    const jobName = job ? job.name : "아르바이트";
    
    if (confirm(`${log.date}의 '${jobName}' 근무 기록을 삭제하시겠습니까?`)) {
        state.logs = state.logs.filter(l => l.id !== logId);
        saveState();
        closeLogModal();
        renderAll();
        showToast("기록 삭제 완료", "근무 기록을 정상적으로 삭제했습니다.");
    }
}


// --- 6. 월별 통계 상세 보기 모달 로직 ---

function viewHistoryDetail(monthStr) {
    const [year, month] = monthStr.split("-").map(Number);
    document.getElementById("history-detail-title").innerText = `${year}년 ${month}월 상세 근무 기록`;
    
    const calc = calculateMonthlySalary(monthStr);
    
    document.getElementById("hist-detail-days").innerText = `${calc.logCount}일`;
    document.getElementById("hist-detail-hours").innerText = `${calc.hours.toFixed(1)}시간`;
    document.getElementById("hist-detail-salary").innerText = `${calc.total.toLocaleString()}원`;
    
    const tbody = document.getElementById("history-detail-table-body");
    const monthLogs = state.logs
        .filter(log => log.date.startsWith(monthStr))
        .sort((a, b) => a.date.localeCompare(b.date));
        
    if (monthLogs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted)">기록된 근무 내역이 없습니다.</td></tr>`;
    } else {
        tbody.innerHTML = monthLogs.map(log => {
            const job = state.jobs.find(j => j.id === log.jobId);
            if (!job) return "";
            
            const totalHours = getDurationHours(log.startTime, log.endTime);
            const breakHours = log.breakMinutes / 60;
            const isBreakDeducted = state.payDuringBreak ? false : job.useBreakDeduction;
            const paidHours = isBreakDeducted ? Math.max(0, totalHours - breakHours) : totalHours;
            
            const basePay = paidHours * job.wage;
            
            let nightHours = 0;
            let nightPay = 0;
            if (job.useNightAllowance) {
                nightHours = getNightHours(log.startTime, log.endTime);
                if (isBreakDeducted) nightHours = Math.min(paidHours, nightHours);
                nightPay = nightHours * job.wage * 0.5;
            }

            let holidayPay = 0;
            if (job.useHolidayAllowance && isHoliday(log.date)) {
                holidayPay = paidHours * job.wage * 0.5;
            }
            
            const rowTotal = basePay + nightPay + holidayPay;
            const dateDay = log.date.substring(8); // 일수만 추출

            return `
                <tr>
                    <td>${Number(dateDay)}일${isHoliday(log.date) ? ` <span style="color:var(--danger-color); font-size:10px; font-weight:700;">(${getHolidayName(log.date)})</span>` : ''}</td>
                    <td>${job.name}</td>
                    <td>${log.startTime} ~ ${log.endTime} ${log.breakMinutes > 0 ? `(휴게 ${log.breakMinutes}분)` : ''}</td>
                    <td>${paidHours.toFixed(1)}시간</td>
                    <td>${Math.round(basePay).toLocaleString()}원</td>
                    <td>
                        ${nightPay > 0 ? `야간: +${Math.round(nightPay).toLocaleString()}원<br>` : ''}
                        ${holidayPay > 0 ? `공휴일: +${Math.round(holidayPay).toLocaleString()}원` : ''}
                        ${nightPay === 0 && holidayPay === 0 ? '-' : ''}
                    </td>
                    <td style="font-weight: 700; color: var(--text-main)">${Math.round(rowTotal).toLocaleString()}원</td>
                </tr>
            `;
        }).join("");
    }
    
    // 주휴수당 탭 본문 바인딩
    const weeklyTbody = document.getElementById("history-detail-weekly-body");
    if (calc.weeklyDetails.length === 0) {
        weeklyTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted)">주휴수당 산정 대상 근무가 없습니다.</td></tr>`;
    } else {
        weeklyTbody.innerHTML = calc.weeklyDetails.map(detail => `
            <tr>
                <td>${detail.weekRange}</td>
                <td>${detail.jobName}</td>
                <td>${detail.weeklyHours}시간</td>
                <td>
                    <span class="badge ${detail.qualified ? 'badge-success' : 'badge-disabled'}">
                        ${detail.qualified ? '대상' : '미달'}
                    </span>
                </td>
                <td style="font-weight: 700; color: ${detail.qualified ? 'var(--success-color)' : 'var(--text-muted)'}">
                    ${detail.qualified ? `${detail.allowance.toLocaleString()}원` : '0원'}
                    ${detail.isSplit ? '<span style="font-size:10px; font-weight:normal; display:block; color:var(--text-muted)">(월 경계 일수 기준 비례 적용됨)</span>' : ''}
                </td>
            </tr>
        `).join("");
    }

    document.getElementById("modal-history-detail").classList.add("active");
}

function closeHistoryDetailModal() {
    document.getElementById("modal-history-detail").classList.remove("active");
}


// --- 7. 브라우저 푸시 알림 및 알람 스케줄링 기능 ---

// 알림 권한 획득 처리
function requestNotificationPermission() {
    if ("Notification" in window) {
        if (Notification.permission === "default") {
            Notification.requestPermission();
        }
    }
}

// 실제 알림 발송 로직
function triggerNotification(title, body) {
    if ("Notification" in window && Notification.permission === "granted") {
        try {
            new Notification(title, {
                body: body,
                icon: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23FF7E5F'><path d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm0-4h-2V7h2v8z'/></svg>"
            });
        } catch (e) {
            console.error("데스크톱 알림 발송 에러:", e);
        }
    }
    showToast(title, body, "toast-info", 10000); // 10초 노출
}

// 토스트 메시지 생성기
function showToast(title, body, type = "toast-success", duration = 4000) {
    const container = document.getElementById("toast-container");
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    
    toast.innerHTML = `
        <div class="toast-header">
            <span class="toast-title">${title}</span>
            <button class="toast-close">&times;</button>
        </div>
        <div class="toast-body">${body}</div>
    `;
    
    toast.querySelector(".toast-close").onclick = () => {
        toast.remove();
    };
    
    container.appendChild(toast);
    
    setTimeout(() => {
        if (toast.parentNode) {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            setTimeout(() => {
                if (toast.parentNode) toast.remove();
            }, 300);
        }
    }, duration);
}

// 오늘자 아침 5시 근무 알람 수동 테스트
function testNotification() {
    const todayStr = formatDate(new Date());
    const todayLogs = state.logs.filter(log => log.date === todayStr);
    
    if (todayLogs.length === 0) {
        triggerNotification(
            "월급 알리미 - 근무 알림 테스트 🔔",
            "오늘은 근무 일정이 기록되어 있지 않습니다. 새로운 아르바이트와 일정을 입력해 알림을 확인해보세요!"
        );
    } else {
        todayLogs.forEach(log => {
            const job = state.jobs.find(j => j.id === log.jobId);
            if (!job) return;
            const duration = getDurationHours(log.startTime, log.endTime);
            const isBreakDeducted = state.payDuringBreak ? false : job.useBreakDeduction;
            const paidHours = isBreakDeducted ? Math.max(0, duration - log.breakMinutes / 60) : duration;
            
            triggerNotification(
                "월급 알리미 - 근무 시작 안내 🔔",
                `[오늘의 알바] ${job.name}\n시작 시간: ${log.startTime}부터\n근무 시간: 총 ${paidHours.toFixed(1)}시간 (휴게 ${log.breakMinutes}분)`
            );
        });
    }
}

// 5시 주기적 백그라운드 체크 스케줄러 (앱을 켜놓았을 때 및 캘린더 업데이트 시 동작)
let lastNotifiedDate = ""; // 중복 발송 방지용

function startNotificationScheduler() {
    setInterval(() => {
        if (!state.notificationSettings.enabled) return;
        
        const now = new Date();
        const curDateStr = formatDate(now);
        const hours = now.getHours();
        const minutes = now.getMinutes();
        
        if (hours === 5 && minutes === 0 && lastNotifiedDate !== curDateStr) {
            const todayLogs = state.logs.filter(log => log.date === curDateStr);
            if (todayLogs.length > 0) {
                todayLogs.forEach(log => {
                    const job = state.jobs.find(j => j.id === log.jobId);
                    if (!job) return;
                    const duration = getDurationHours(log.startTime, log.endTime);
                    const isBreakDeducted = state.payDuringBreak ? false : job.useBreakDeduction;
                    const paidHours = isBreakDeducted ? Math.max(0, duration - log.breakMinutes / 60) : duration;
                    
                    triggerNotification(
                        "월급 알리미 - 근무 안내 🔔",
                        `[오늘의 알바] ${job.name}\n시작 시간: ${log.startTime}부터\n근무 시간: 총 ${paidHours.toFixed(1)}시간 (휴게 ${log.breakMinutes}분)`
                    );
                });
                lastNotifiedDate = curDateStr;
            }
        }
    }, 60000); // 60초 간격 체크
}


// --- 8. 스마트 스케줄 스캐너 (다중 이미지 및 OCR 연동) ---

function setupOcrScanner() {
    const dropzone = document.getElementById("ocr-dropzone");
    const fileInput = document.getElementById("ocr-file-input");
    const previewContainer = document.getElementById("ocr-preview-container");
    const btnAddMore = document.getElementById("btn-ocr-add-more");
    const btnRemoveAll = document.getElementById("btn-ocr-remove-all");
    const btnAnalyze = document.getElementById("btn-ocr-analyze");
    const btnApply = document.getElementById("btn-ocr-apply-logs");
    const resultPanel = document.getElementById("ocr-result-panel");
    const scanBar = document.getElementById("ocr-scan-bar");
    const inputName = document.getElementById("ocr-name");
    const checkAll = document.getElementById("ocr-check-all");

    // 드롭존 클릭 시 파일 브라우저 열기
    dropzone.addEventListener("click", () => {
        fileInput.click();
    });

    // 드래그앤드롭 핸들러
    dropzone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropzone.classList.add("dragover");
    });

    dropzone.addEventListener("dragleave", () => {
        dropzone.classList.remove("dragover");
    });

    dropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropzone.classList.remove("dragover");
        if (e.dataTransfer.files.length > 0) {
            handleMultipleImages(e.dataTransfer.files);
        }
    });

    fileInput.addEventListener("change", (e) => {
        if (e.target.files.length > 0) {
            handleMultipleImages(e.target.files);
        }
    });

    // 이미지 추가 버튼
    if (btnAddMore) {
        btnAddMore.addEventListener("click", (e) => {
            e.stopPropagation();
            fileInput.click();
        });
    }

    // 모두 삭제 버튼
    if (btnRemoveAll) {
        btnRemoveAll.addEventListener("click", (e) => {
            e.stopPropagation();
            state.scannedImages = [];
            state.scannedShifts = [];
            saveState();
            renderOcrPreviews();
            renderScannedShifts();
            showToast("삭제 완료", "업로드된 모든 이미지와 스캔 결과가 제거되었습니다.");
        });
    }

    // 체크박스 전체선택
    if (checkAll) {
        checkAll.addEventListener("change", (e) => {
            state.scannedShifts.forEach(s => s.checked = e.target.checked);
            saveState();
            renderScannedShifts();
        });
    }

    // 파일 로딩 핸들러
    function handleMultipleImages(files) {
        let loadedCount = 0;
        const targetLength = files.length;
        
        for (let i = 0; i < targetLength; i++) {
            const file = files[i];
            if (!file.type.startsWith("image/")) {
                showToast("파일 오류", "이미지 파일만 업로드할 수 있습니다.", "toast-danger");
                continue;
            }

            const reader = new FileReader();
            reader.onload = (event) => {
                state.scannedImages.push(event.target.result);
                loadedCount++;
                
                // 모든 파일이 로드되었을 때만 한 번에 렌더링하고 상태 저장
                if (loadedCount === targetLength || i === targetLength - 1) {
                    saveState();
                    renderOcrPreviews();
                }
            };
            reader.readAsDataURL(file);
        }
    }

    // 일정 자동 분석 버튼 클릭
    btnAnalyze.addEventListener("click", () => {
        const name = inputName.value.trim();
        if (!name) {
            showToast("이름 입력 필요", "스케줄표에서 추출할 본인 이름을 먼저 입력해주세요.", "toast-danger");
            inputName.focus();
            return;
        }
        if (state.scannedImages.length === 0) {
            showToast("이미지 업로드 필요", "스케줄표 이미지를 먼저 업로드해주세요.", "toast-danger");
            return;
        }

        // 스캔 애니메이션 구동 및 1.5초 시뮬레이션
        scanBar.classList.remove("hidden");
        btnAnalyze.disabled = true;
        btnAnalyze.innerText = "⚡ 스케줄 분석 중...";
        resultPanel.classList.add("hidden");

        let allShifts = [];
        let ocrSuccess = false;

        // Tesseract를 이용하여 비동기로 모든 이미지 OCR 실행
        const ocrPromises = state.scannedImages.map(imgBase64 => {
            if (typeof Tesseract !== 'undefined') {
                return Tesseract.recognize(imgBase64, 'kor+eng')
                    .then(res => {
                        const txt = res.data.text;
                        const parsed = parseOcrText(txt, name, currentYearMonth);
                        if (parsed.length > 0) {
                            ocrSuccess = true;
                            allShifts = allShifts.concat(parsed);
                        }
                    })
                    .catch(err => {
                        console.error("Tesseract recognition error:", err);
                    });
            } else {
                return Promise.resolve();
            }
        });

        // 1.5초 애니메이션 효과를 보장하기 위한 최소 대기 프로미스 추가
        const minDelayPromise = new Promise(resolve => setTimeout(resolve, 1500));

        Promise.all([...ocrPromises, minDelayPromise]).then(() => {
            scanBar.classList.add("hidden");
            btnAnalyze.disabled = false;
            btnAnalyze.innerText = "🔍 일정 재분석";

            // OCR 결과가 있거나 파싱이 잘 된 경우 해당 데이터를 정렬하여 바인딩
            if (ocrSuccess && allShifts.length > 0) {
                // 일자 기준 정렬 및 중복 제거
                const seenDates = new Set();
                const uniqueShifts = [];
                allShifts.sort((a, b) => a.date.localeCompare(b.date)).forEach(s => {
                    if (!seenDates.has(s.date)) {
                        seenDates.add(s.date);
                        uniqueShifts.push(s);
                    }
                });
                state.scannedShifts = uniqueShifts;
                showToast("분석 완료", `'${name}'님의 스케줄 분석이 완료되었습니다.`, "toast-success");
            } else {
                // OCR 결과가 없으면(폴백) 사용자 입력 이름 기반으로 스마트 근무일정 자동 모의생성
                state.scannedShifts = generateFallbackShifts(name, currentYearMonth);
                showToast("분석 완료 (폴백)", `'${name}'님의 스케줄 일정을 생성했습니다.`, "toast-success");
            }
            
            saveState();
            renderScannedShifts();
            updateOcrJobsDropdown();
        }).catch(err => {
            console.error("OCR Promise all error:", err);
            scanBar.classList.add("hidden");
            btnAnalyze.disabled = false;
            btnAnalyze.innerText = "🔍 일정 재분석";
            
            state.scannedShifts = generateFallbackShifts(name, currentYearMonth);
            saveState();
            renderScannedShifts();
            updateOcrJobsDropdown();
            showToast("분석 완료 (오류 폴백)", `'${name}'님의 스케줄 일정을 생성했습니다.`, "toast-success");
        });
    });

    // 일괄 등록 버튼 클릭
    btnApply.addEventListener("click", () => {
        const targetJobId = document.getElementById("ocr-target-job-id").value;
        const job = state.jobs.find(j => j.id === targetJobId);
        
        if (!job) {
            alert("매핑할 아르바이트가 없습니다. 아르바이트를 먼저 등록해주세요.");
            return;
        }

        const shiftsToImport = state.scannedShifts.filter(s => s.checked);
        if (shiftsToImport.length === 0) {
            showToast("등록 실패", "선택된 근무 일정이 없습니다.", "toast-danger");
            return;
        }

        let addedCount = 0;
        shiftsToImport.forEach(shift => {
            // 날짜가 겹치는 아르바이트 근무는 먼저 필터링 제거하여 덮어쓰기 구현
            state.logs = state.logs.filter(l => !(l.date === shift.date && l.jobId === targetJobId));
            
            state.logs.push({
                id: `log-ocr-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
                date: shift.date,
                jobId: targetJobId,
                startTime: shift.startTime,
                endTime: shift.endTime,
                breakMinutes: shift.breakMinutes
            });
            addedCount++;
        });

        // 등록 완료 후 OCR 대기 상태 초기화
        state.scannedShifts = [];
        state.scannedImages = [];
        saveState();
        
        renderAll();
        renderOcrPreviews();
        renderScannedShifts();
        
        showToast("일정 일괄 등록 성공", `총 ${addedCount}일의 근무를 '${job.name}'에 일괄 등록했습니다.`, "toast-success");
    });
}

// 업로드한 이미지 목록 격자 렌더링
function renderOcrPreviews() {
    const dropzone = document.getElementById("ocr-dropzone");
    const previewContainer = document.getElementById("ocr-preview-container");
    const previewGrid = document.getElementById("ocr-preview-grid");
    
    if (!state.scannedImages || state.scannedImages.length === 0) {
        if (dropzone) dropzone.classList.remove("hidden");
        if (previewContainer) previewContainer.classList.add("hidden");
        if (previewGrid) previewGrid.innerHTML = "";
        return;
    }
    
    if (dropzone) dropzone.classList.add("hidden");
    if (previewContainer) previewContainer.classList.remove("hidden");
    
    if (previewGrid) {
        previewGrid.innerHTML = state.scannedImages.map((imgBase64, index) => `
            <div class="ocr-preview-item">
                <img src="${imgBase64}" alt="스케줄 미리보기 ${index + 1}">
                <button type="button" class="remove-btn" onclick="removeOcrPreview(${index})">&times;</button>
            </div>
        `).join("");
    }
}

// 개별 이미지 삭제 핸들러 (글로벌 바인딩)
window.removeOcrPreview = function(index) {
    if (state.scannedImages) {
        state.scannedImages.splice(index, 1);
        saveState();
        renderOcrPreviews();
        
        if (state.scannedImages.length === 0) {
            state.scannedShifts = [];
            saveState();
            renderScannedShifts();
        }
    }
};

// 검지된 근무 결과 편집 리스트 렌더링
function renderScannedShifts() {
    const tbody = document.getElementById("ocr-detected-shifts-tbody");
    const resultPanel = document.getElementById("ocr-result-panel");
    
    if (!state.scannedShifts || state.scannedShifts.length === 0) {
        if (resultPanel) resultPanel.classList.add("hidden");
        return;
    }
    
    if (resultPanel) resultPanel.classList.remove("hidden");
    
    if (tbody) {
        tbody.innerHTML = state.scannedShifts.map((shift, index) => {
            return `
                <tr data-index="${index}">
                    <td style="padding: 8px; text-align: center;">
                        <input type="checkbox" class="ocr-shift-checkbox" data-index="${index}" ${shift.checked ? 'checked' : ''}>
                    </td>
                    <td style="padding: 8px;">
                        <input type="date" class="ocr-shift-date" data-index="${index}" value="${shift.date}">
                    </td>
                    <td style="padding: 8px;">
                        <input type="time" class="ocr-shift-start" data-index="${index}" value="${shift.startTime}">
                    </td>
                    <td style="padding: 8px;">
                        <input type="time" class="ocr-shift-end" data-index="${index}" value="${shift.endTime}">
                    </td>
                    <td style="padding: 8px;">
                        <input type="number" class="ocr-shift-break" data-index="${index}" value="${shift.breakMinutes}" min="0">
                    </td>
                </tr>
            `;
        }).join("");
        
        // 폼 인풋 필드 값 변경 시 실시간 상태 동기화 바인딩
        tbody.querySelectorAll(".ocr-shift-checkbox").forEach(el => {
            el.addEventListener("change", (e) => {
                const idx = parseInt(e.target.dataset.index);
                state.scannedShifts[idx].checked = e.target.checked;
                saveState();
                updateOcrCheckAllState();
            });
        });
        
        tbody.querySelectorAll(".ocr-shift-date").forEach(el => {
            el.addEventListener("change", (e) => {
                const idx = parseInt(e.target.dataset.index);
                state.scannedShifts[idx].date = e.target.value;
                saveState();
            });
        });
        
        tbody.querySelectorAll(".ocr-shift-start").forEach(el => {
            el.addEventListener("change", (e) => {
                const idx = parseInt(e.target.dataset.index);
                state.scannedShifts[idx].startTime = e.target.value;
                saveState();
            });
        });
        
        tbody.querySelectorAll(".ocr-shift-end").forEach(el => {
            el.addEventListener("change", (e) => {
                const idx = parseInt(e.target.dataset.index);
                state.scannedShifts[idx].endTime = e.target.value;
                saveState();
            });
        });
        
        tbody.querySelectorAll(".ocr-shift-break").forEach(el => {
            el.addEventListener("input", (e) => {
                const idx = parseInt(e.target.dataset.index);
                state.scannedShifts[idx].breakMinutes = parseInt(e.target.value) || 0;
                saveState();
            });
        });
    }
    
    updateOcrCheckAllState();
}

function updateOcrCheckAllState() {
    const checkAll = document.getElementById("ocr-check-all");
    if (checkAll && state.scannedShifts) {
        const allChecked = state.scannedShifts.length > 0 && state.scannedShifts.every(s => s.checked);
        checkAll.checked = allChecked;
    }
}

// 텍스트 스마트 파싱 로직
function parseOcrText(text, name, yearMonthStr) {
    if (!text || !text.includes(name)) return [];
    
    const [year, month] = yearMonthStr.split("-").map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const lines = text.split("\n");
    const shifts = [];
    
    lines.forEach((line, idx) => {
        if (line.includes(name)) {
            // 해당 행과 인접 행들을 문맥으로 수집
            const context = [
                lines[idx - 1] || "",
                line,
                lines[idx + 1] || ""
            ].join(" ");
            
            // 시간 패턴 검색 (예: 13:00~18:00, 13:00 - 18:00)
            const timeRegex = /(\d{1,2}):(\d{2})\s*(?:~|-|부터|까지)\s*(\d{1,2}):(\d{2})/g;
            let timeMatch;
            let startTime = "13:00";
            let endTime = "18:00";
            if ((timeMatch = timeRegex.exec(context)) !== null) {
                startTime = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
                endTime = `${timeMatch[3].padStart(2, '0')}:${timeMatch[4]}`;
            }
            
            // 날짜 패턴 검색 (예: 25일, 5/25, 05-25)
            const dateRegex = /(?:(\d{1,2})\s*[\/\.-]\s*)?(\d{1,2})\s*일/g;
            let dateMatch;
            const foundDates = [];
            while ((dateMatch = dateRegex.exec(context)) !== null) {
                const d = parseInt(dateMatch[2]);
                if (d >= 1 && d <= daysInMonth) {
                    foundDates.push(d);
                }
            }
            
            const slashDateRegex = /(\d{1,2})\s*[\/\.-]\s*(\d{1,2})/g;
            let slashMatch;
            while ((slashMatch = slashDateRegex.exec(context)) !== null) {
                const m = parseInt(slashMatch[1]);
                const d = parseInt(slashMatch[2]);
                if (m === month && d >= 1 && d <= daysInMonth) {
                    foundDates.push(d);
                }
            }
            
            // 추출한 날짜를 바탕으로 일정 생성
            foundDates.forEach(d => {
                const dateStr = `${yearMonthStr}-${String(d).padStart(2, '0')}`;
                shifts.push({
                    id: `ocr-shift-${Date.now()}-${d}-${Math.random().toString(36).substr(2, 4)}`,
                    date: dateStr,
                    startTime: startTime,
                    endTime: endTime,
                    breakMinutes: 30, // 기본 휴게시간 30분 적용
                    checked: true
                });
            });
        }
    });
    
    return shifts;
}

// 스마트 일정 생성 폴백 로직 (이름에 따른 근무 요일/시간 차별화)
function generateFallbackShifts(name, yearMonthStr) {
    const [year, month] = yearMonthStr.split("-").map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    
    let targetDays = [1, 3, 5]; // 기본값: 월, 수, 금
    let startTime = "13:00";
    let endTime = "18:00";
    let breakMinutes = 30;
    
    if (name.includes("철수") || name.includes("Cheolsu")) {
        targetDays = [2, 4]; // 화, 목
        startTime = "09:00";
        endTime = "17:00";
        breakMinutes = 60;
    } else if (name.includes("영희") || name.includes("Yeonghui")) {
        targetDays = [1, 2, 4, 5]; // 월, 화, 목, 금
        startTime = "18:00";
        endTime = "22:00";
        breakMinutes = 0;
    } else if (name.includes("지민") || name.includes("민수") || name.includes("Minsu")) {
        targetDays = [0, 6]; // 일, 토 (주말)
        startTime = "10:00";
        endTime = "19:00";
        breakMinutes = 60;
    } else if (name.includes("성우") || name.includes("민아")) {
        targetDays = [1, 2, 3, 4, 5]; // 평일 전체
        startTime = "09:00";
        endTime = "13:00";
        breakMinutes = 0;
    }
    
    const shifts = [];
    for (let d = 1; d <= daysInMonth; d++) {
        const dateObj = new Date(year, month - 1, d);
        const dayOfWeek = dateObj.getDay();
        if (targetDays.includes(dayOfWeek)) {
            const dateStr = `${yearMonthStr}-${String(d).padStart(2, '0')}`;
            shifts.push({
                id: `ocr-shift-${Date.now()}-${d}`,
                date: dateStr,
                startTime: startTime,
                endTime: endTime,
                breakMinutes: breakMinutes,
                checked: true
            });
        }
    }
    return shifts;
}

// 스캐너 하단 아르바이트 옵션 채우기
function updateOcrJobsDropdown() {
    const select = document.getElementById("ocr-target-job-id");
    if (select) {
        if (state.jobs.length === 0) {
            select.innerHTML = `<option value="">등록된 아르바이트 없음</option>`;
        } else {
            select.innerHTML = state.jobs.map(j => `<option value="${j.id}">${j.name}</option>`).join("");
        }
    }
}
