package com.example.ticketreservation.service;

import com.example.ticketreservation.dto.StatsResponse;
import com.example.ticketreservation.model.Reservation;
import com.example.ticketreservation.model.ReservationStatus;
import com.example.ticketreservation.repository.EventRepository;
import com.example.ticketreservation.repository.ReservationRepository;
import com.example.ticketreservation.repository.UserRepository;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class AdminService {

    private final UserRepository userRepository;
    private final EventRepository eventRepository;
    private final ReservationRepository reservationRepository;

    public AdminService(UserRepository userRepository, EventRepository eventRepository,
                        ReservationRepository reservationRepository) {
        this.userRepository = userRepository;
        this.eventRepository = eventRepository;
        this.reservationRepository = reservationRepository;
    }

    public StatsResponse stats() {
        List<Reservation> all = reservationRepository.findAll();
        List<Reservation> confirmed = all.stream()
                .filter(r -> r.getStatus() == ReservationStatus.CONFIRMED).toList();
        long ticketsSold = confirmed.stream().mapToLong(Reservation::getSeats).sum();
        double revenue = confirmed.stream().mapToDouble(Reservation::getTotalAmount).sum();
        return new StatsResponse(userRepository.count(), eventRepository.count(),
                all.size(), confirmed.size(), ticketsSold, revenue);
    }
}
